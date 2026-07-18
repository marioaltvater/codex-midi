/**
 * Private local transport between the ChatGPT preload and Project2077 engine.
 * It owns socket permissions and framing; controller and MIDI concerns stay elsewhere.
 */

import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import {
  type AppActionMessage,
  BRIDGE_PROTOCOL_VERSION,
  decodeReportData,
  encodeIpcMessage,
  SYNTHETIC_HID_PATH,
  type BridgeErrorMessage,
  type DeviceReportMessage,
} from "./shim-protocol.js";
import type { CodexHostTransport, HostReportHandler } from "../core/codex-micro.js";
import type { AppActionDispatcher, CodexAppAction } from "../controllers/controller.js";

const ACTION_TIMEOUT_MS = 2_000;

interface ClientState {
  socket: Socket;
  ready: boolean;
  closing: boolean;
  buffer: string;
  processing: Promise<void>;
}

interface PendingAction {
  client: ClientState;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface UnixSocketTransportOptions {
  socketPath?: string;
  token?: string;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export class UnixSocketHostTransport implements CodexHostTransport, AppActionDispatcher {
  readonly socketPath: string;
  readonly #logger: Pick<Console, "debug" | "info" | "warn" | "error">;
  readonly #token: string | undefined;
  readonly #clients = new Set<ClientState>();
  readonly #pendingActions = new Map<number, PendingAction>();
  #handler: HostReportHandler | null = null;
  #server: Server | null = null;
  #ownsSocket = false;
  #nextActionId = 1;

  constructor(options: UnixSocketTransportOptions = {}) {
    this.socketPath =
      options.socketPath ?? `/tmp/codex-midi-${process.getuid?.() ?? "user"}/project2077.sock`;
    this.#token = options.token;
    this.#logger = options.logger ?? console;
  }

  async start(handler: HostReportHandler): Promise<void> {
    if (this.#server !== null) return;
    this.#handler = handler;
    await ensurePrivateDirectory(dirname(this.socketPath));
    await removeStaleSocket(this.socketPath);

    const server = createServer((socket) => this.#accept(socket));
    this.#server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.socketPath);
      });
      this.#ownsSocket = true;
      await chmod(this.socketPath, 0o600);
      this.#logger.info(`Project2077 shim socket listening at ${this.socketPath}`);
    } catch (error) {
      this.#server = null;
      this.#handler = null;
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      if (this.#ownsSocket) {
        this.#ownsSocket = false;
        await rm(this.socketPath, { force: true });
      }
      throw error;
    }
  }

  async sendDeviceReport(reportLike: Uint8Array): Promise<void> {
    const report = Buffer.from(reportLike);
    if (report.length !== 64) throw new RangeError("Device reports must be exactly 64 bytes");
    const message: DeviceReportMessage = {
      v: BRIDGE_PROTOCOL_VERSION,
      type: "device-report",
      data: report.toString("base64"),
    };
    const line = encodeIpcMessage(message);
    await Promise.all(
      [...this.#clients]
        .filter((client) => client.ready && !client.closing && !client.socket.destroyed)
        .map((client) => writeSocket(client.socket, line)),
    );
  }

  dispatch(action: CodexAppAction): Promise<void> {
    const client = [...this.#clients].find(
      (candidate) => candidate.ready && !candidate.closing && !candidate.socket.destroyed,
    );
    if (client === undefined) {
      return Promise.reject(new Error("No ChatGPT host is connected"));
    }

    const id = this.#nextActionId;
    this.#nextActionId += 1;
    const message: AppActionMessage = {
      v: BRIDGE_PROTOCOL_VERSION,
      type: "app-action",
      id,
      action,
    };

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.#pendingActions.delete(id)) return;
        reject(new Error(`ChatGPT action timed out: ${action}`));
      }, ACTION_TIMEOUT_MS);
      this.#pendingActions.set(id, { client, resolve, reject, timeout });
      writeSocket(client.socket, encodeIpcMessage(message)).catch((error: unknown) => {
        const pending = this.#pendingActions.get(id);
        if (pending === undefined) return;
        this.#pendingActions.delete(id);
        clearTimeout(pending.timeout);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.#server;
    const ownsSocket = this.#ownsSocket;
    this.#server = null;
    this.#ownsSocket = false;
    this.#handler = null;
    this.#rejectPendingActions(undefined, "codex-midi bridge stopped");
    for (const client of this.#clients) client.socket.destroy();
    this.#clients.clear();
    if (server !== null) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (ownsSocket) await rm(this.socketPath, { force: true });
  }

  #accept(socket: Socket): void {
    socket.setNoDelay(true);
    const client: ClientState = {
      socket,
      ready: false,
      closing: false,
      buffer: "",
      processing: Promise.resolve(),
    };
    this.#clients.add(client);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      if (client.closing) return;
      client.buffer += chunk;
      if (client.buffer.length > 1024 * 1024) {
        this.#sendErrorAndClose(client, "IPC receive buffer exceeded 1 MiB");
        return;
      }
      for (;;) {
        const newline = client.buffer.indexOf("\n");
        if (newline < 0) break;
        const line = client.buffer.slice(0, newline);
        client.buffer = client.buffer.slice(newline + 1);
        if (line.trim().length > 0) {
          client.processing = client.processing
            .then(() => this.#receiveLine(client, line))
            .catch((error: unknown) => {
              this.#logger.warn("Project2077 IPC message failed", error);
              client.socket.destroy();
            });
        }
      }
    });
    socket.on("error", (error) => this.#logger.warn("Project2077 shim socket error", error));
    socket.on("close", () => {
      const wasReady = client.ready;
      this.#clients.delete(client);
      this.#rejectPendingActions(client, "ChatGPT host disconnected");
      if (wasReady && ![...this.#clients].some((candidate) => candidate.ready)) {
        void Promise.resolve()
          .then(() => this.#handler?.onHostDisconnected())
          .catch((error: unknown) => {
            this.#logger.warn("Project2077 host disconnect cleanup failed", error);
          });
      }
    });
  }

  async #receiveLine(client: ClientState, line: string): Promise<void> {
    if (client.closing) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.#sendErrorAndClose(client, "Invalid JSON IPC message");
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.#sendErrorAndClose(client, "Invalid JSON IPC message");
      return;
    }
    const message = value as Record<string, unknown>;

    if (message.v !== BRIDGE_PROTOCOL_VERSION) {
      this.#sendErrorAndClose(client, `Unsupported bridge protocol version: ${String(message.v)}`);
      return;
    }
    if (!client.ready) {
      if (
        message.type !== "hello" ||
        message.role !== "node-hid-shim" ||
        message.path !== SYNTHETIC_HID_PATH ||
        (this.#token !== undefined && message.token !== this.#token)
      ) {
        this.#sendErrorAndClose(client, "Expected node-hid shim hello");
        return;
      }
      if ([...this.#clients].some((candidate) => candidate !== client && candidate.ready)) {
        this.#sendErrorAndClose(client, "A Project2077 host is already connected");
        return;
      }
      client.ready = true;
      client.socket.write(
        encodeIpcMessage({
          v: BRIDGE_PROTOCOL_VERSION,
          type: "hello-ack",
          ...(this.#token === undefined ? {} : { token: this.#token }),
        }),
      );
      this.#logger.info("Project2077 shim host connected");
      if ([...this.#clients].filter((candidate) => candidate.ready).length === 1) {
        await this.#handler?.onHostConnected();
      }
      return;
    }

    if (message.type === "app-action-result") {
      this.#receiveActionResult(client, message);
      return;
    }
    if (message.type !== "host-report") {
      this.#sendErrorAndClose(client, `Unexpected IPC message: ${String(message.type)}`);
      return;
    }
    try {
      const report = decodeReportData(message.data);
      await this.#handler?.onHostReport(report);
    } catch (error) {
      this.#sendErrorAndClose(
        client,
        error instanceof Error ? error.message : "Invalid host report",
      );
    }
  }

  #receiveActionResult(client: ClientState, message: Record<string, unknown>): void {
    if (!Number.isSafeInteger(message.id) || typeof message.ok !== "boolean") {
      this.#logger.warn("ChatGPT returned an invalid app-action result");
      return;
    }
    const id = message.id as number;
    const pending = this.#pendingActions.get(id);
    if (pending === undefined || pending.client !== client) return;

    this.#pendingActions.delete(id);
    clearTimeout(pending.timeout);
    if (message.ok) {
      pending.resolve();
      return;
    }
    pending.reject(
      new Error(
        typeof message.error === "string" && message.error.length > 0
          ? message.error
          : "ChatGPT rejected the app action",
      ),
    );
  }

  #rejectPendingActions(client: ClientState | undefined, message: string): void {
    for (const [id, pending] of this.#pendingActions) {
      if (client !== undefined && pending.client !== client) continue;
      this.#pendingActions.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
  }

  #sendErrorAndClose(client: ClientState, message: string): void {
    if (client.closing) return;
    client.closing = true;
    const response: BridgeErrorMessage = {
      v: BRIDGE_PROTOCOL_VERSION,
      type: "error",
      message,
    };
    client.socket.end(encodeIpcMessage(response));
  }
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  try {
    const stat = await lstat(socketPath);
    if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket path: ${socketPath}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }

  const active = await new Promise<boolean>((resolve) => {
    const probe = createConnection(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
  if (active) throw new Error(`Another codex-midi bridge is already listening at ${socketPath}`);
  await rm(socketPath, { force: true });
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  const created = await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Bridge runtime directory must be a real directory: ${path}`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && info.uid !== uid) {
    throw new Error(`Bridge runtime directory is not owned by the current user: ${path}`);
  }
  if (created !== undefined) {
    await chmod(path, 0o700);
    return;
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`Bridge runtime directory must have mode 0700: ${path}`);
  }
}

function writeSocket(socket: Socket, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (error) => (error === null || error === undefined ? resolve() : reject(error)));
  });
}

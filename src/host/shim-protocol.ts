/** Messages shared by the local ChatGPT preload and the Unix-socket bridge. */

import type { CodexAppAction } from "../controllers/controller.js";

export const BRIDGE_PROTOCOL_VERSION = 2 as const;
export const SYNTHETIC_HID_PATH = "codex-midi://project2077" as const;

interface ShimHello {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  type: "hello";
  role: "node-hid-shim";
  path: typeof SYNTHETIC_HID_PATH;
  token?: string;
}

interface HelloAck {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  type: "hello-ack";
  token?: string;
}

interface HostReportMessage {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  type: "host-report";
  data: string;
}

export interface DeviceReportMessage {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  type: "device-report";
  data: string;
}

export interface AppActionMessage {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  type: "app-action";
  id: number;
  action: CodexAppAction;
}

export interface AppActionResultMessage {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  type: "app-action-result";
  id: number;
  ok: boolean;
  error?: string;
}

export interface BridgeErrorMessage {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  type: "error";
  message: string;
}

type ShimToBridgeMessage = ShimHello | HostReportMessage | AppActionResultMessage;
type BridgeToShimMessage = HelloAck | DeviceReportMessage | AppActionMessage | BridgeErrorMessage;

export function encodeIpcMessage(message: ShimToBridgeMessage | BridgeToShimMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function decodeReportData(data: unknown): Buffer {
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("Report data must be a non-empty base64 string");
  }
  const report = Buffer.from(data, "base64");
  if (report.length !== 64 || report.toString("base64") !== data) {
    throw new Error("Report data must encode exactly 64 bytes of canonical base64");
  }
  return report;
}

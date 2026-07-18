/**
 * Adapts a controller profile to the engine-facing ControllerSurface. This is
 * the shared home for MIDI decoding, modifiers, actions, aliases, encoder
 * pacing, reconnects, and lighting replay. Vendor protocols stay in profiles.
 */

import type {
  CodexButtonKey,
  CodexLightingState,
  ControllerSurface,
  SurfaceInputSink,
} from "../core/codex-micro.js";
import {
  midi,
  type MidiBackend,
  type MidiInputHandle,
  type MidiMessage,
  type MidiOutputHandle,
} from "../midi/index.js";
import type { ControllerConfig } from "../config.js";
import type { CodexAppAction, ControllerContext } from "./controller.js";
import type {
  ControllerConnection,
  DisconnectReason,
  EncoderTarget,
  JoystickDirection,
  LightingFrame,
  MidiActionBinding,
  MidiControllerProfile,
  RelativeEncoder,
} from "./midi-profile.js";

type LogicalTarget =
  | { readonly kind: "key"; readonly key: CodexButtonKey }
  | { readonly kind: "joystick"; readonly direction: JoystickDirection };

interface HeldTarget {
  readonly target: LogicalTarget;
  count: number;
}

interface EncoderState {
  direction: "clockwise" | "counterClockwise";
  pulses: number;
  lastPulseAt: number;
  lastStepAt: number;
}

type ConnectionFailure = "refresh" | "open" | "session" | "lighting";

const JOYSTICK_POSITIONS: Readonly<Record<JoystickDirection, number>> = {
  right: 0,
  down: 0.25,
  left: 0.5,
  up: 0.75,
};

export function createMidiSurface(
  profile: MidiControllerProfile,
  config: Readonly<ControllerConfig>,
  context: ControllerContext,
  backend: MidiBackend = midi,
): ControllerSurface {
  const inputName = config.inputName ?? profile.ports.input;
  const outputName =
    config.outputName ??
    (config.inputName !== undefined && profile.ports.output === profile.ports.input
      ? config.inputName
      : profile.ports.output);
  const inputChannel = profile.inputChannel ?? 0;
  const notes = profile.mapping.notes ?? {};
  const buttons = profile.mapping.buttons ?? {};
  const joystick = profile.mapping.joystick ?? {};
  const noteActions = profile.mapping.actions?.notes ?? {};
  const buttonActions = profile.mapping.actions?.buttons ?? {};
  const shiftNotes = new Set(profile.mapping.shift?.notes ?? []);
  const shiftButtons = new Set(profile.mapping.shift?.buttons ?? []);
  const encoders = new Map(
    profile.encoders?.map((encoder) => [encoder.cc, encoder]) ?? [],
  );
  const logger = context.logger;
  const session = profile.createSession?.();

  let sink: SurfaceInputSink | undefined;
  let input: MidiInputHandle | undefined;
  let output: MidiOutputHandle | undefined;
  let reconnectTimer: ReturnType<typeof setInterval> | undefined;
  let connecting = false;
  let closing = false;
  let generation = 0;
  let ready = false;
  let latestLighting: Readonly<CodexLightingState> | undefined;
  const renderedLighting = new Map<string, string>();
  const heldControls = new Map<string, string>();
  const heldTargets = new Map<string, HeldTarget>();
  const heldActionSources = new Set<string>();
  const heldShiftSources = new Set<string>();
  const encoderStates = new Map<number, EncoderState>();
  let shiftPressed = false;
  let lastConnectionFailure: ConnectionFailure | undefined;

  const connection: ControllerConnection = {
    logger,
    send(message) {
      if (output === undefined) throw new Error("MIDI output is not connected");
      output.send(message);
    },
    dispatchAction(action) {
      dispatchAppAction(action);
    },
    ready() {
      if (
        ready ||
        input === undefined ||
        (outputName !== undefined && output === undefined)
      ) {
        return;
      }
      ready = true;
      renderedLighting.clear();
      replayLighting();
      if (
        input === undefined ||
        (outputName !== undefined && output === undefined)
      ) {
        return;
      }
      lastConnectionFailure = undefined;
      logger.info(
        `Connected to ${profile.displayName} MIDI ${
          outputName === undefined
            ? `input: ${inputName}`
            : `ports: ${inputName} / ${outputName}`
        }`,
      );
    },
    reconnect() {
      warnConnectionFailure(
        "session",
        `${profile.displayName} MIDI session requested a reconnect`,
      );
      closeConnection("error");
    },
  };

  return {
    async start(nextSink) {
      if (sink !== undefined) return;
      lastConnectionFailure = undefined;
      const startedGeneration = ++generation;
      sink = nextSink;
      await refreshConnection();
      if (sink !== undefined && generation === startedGeneration) {
        reconnectTimer = setInterval(() => void refreshConnection(), 1_000);
      }
    },

    async applyFeedback(state) {
      latestLighting = state;
      replayLighting();
    },

    async stop() {
      generation += 1;
      if (reconnectTimer !== undefined) clearInterval(reconnectTimer);
      reconnectTimer = undefined;
      closeConnection("stopped");
      sink = undefined;
    },
  };

  async function refreshConnection(): Promise<void> {
    if (connecting || sink === undefined) return;
    const activeGeneration = generation;
    connecting = true;
    try {
      if (input !== undefined && (outputName === undefined || output !== undefined)) {
        const ports = await backend.listPorts();
        if (!isActive(activeGeneration)) return;
        const connectionLost =
          !input.isOpen() ||
          !ports.inputs.includes(inputName) ||
          (outputName !== undefined &&
            (output === undefined || !output.isOpen() || !ports.outputs.includes(outputName)));
        if (connectionLost) {
          lastConnectionFailure = undefined;
          logger.info(`${profile.displayName} MIDI port disappeared; waiting for it to return`);
          closeConnection("lost");
        }
        return;
      }

      const ports = await backend.listPorts();
      if (!isActive(activeGeneration)) return;
      if (
        !ports.inputs.includes(inputName) ||
        (outputName !== undefined && !ports.outputs.includes(outputName))
      ) {
        lastConnectionFailure = undefined;
        return;
      }

      let candidateInput: MidiInputHandle | undefined;
      let candidateOutput: MidiOutputHandle | undefined;
      try {
        candidateInput = await backend.openInput(inputName, handleMessage);
        if (!isActive(activeGeneration)) {
          closeMidiHandles(candidateInput);
          return;
        }
        if (outputName !== undefined) {
          candidateOutput = await backend.openOutput(outputName);
          if (!isActive(activeGeneration)) {
            closeMidiHandles(candidateInput, candidateOutput);
            return;
          }
        }
        input = candidateInput;
        output = candidateOutput;
      } catch (error) {
        closeMidiHandles(candidateInput, candidateOutput);
        warnConnectionFailure(
          "open",
          `Could not open ${profile.displayName} MIDI ports`,
          error,
        );
        return;
      }

      try {
        if (session === undefined) connection.ready();
        else session.connect(connection);
      } catch (error) {
        warnConnectionFailure(
          "session",
          `${profile.displayName} connect hook failed; reconnecting`,
          error,
        );
        closeConnection("error");
        return;
      }
    } catch (error) {
      warnConnectionFailure(
        "refresh",
        `Could not refresh ${profile.displayName} MIDI connection`,
        error,
      );
      closeConnection("error");
    } finally {
      connecting = false;
    }
  }

  function isActive(activeGeneration: number): boolean {
    return sink !== undefined && generation === activeGeneration;
  }

  function warnConnectionFailure(
    failure: ConnectionFailure,
    message: string,
    error?: unknown,
  ): void {
    if (lastConnectionFailure === failure) return;
    lastConnectionFailure = failure;
    if (error === undefined) logger.warn(message);
    else logger.warn(message, error);
  }

  function handleMessage(_deltaTime: number, message: MidiMessage): void {
    try {
      routeMessage(message);
    } catch (error) {
      logger.warn(`${profile.displayName} MIDI decoder failed; reconnecting`, error);
      closeConnection("error");
    }
  }

  function routeMessage(message: MidiMessage): void {
    if (session?.handleMessage?.(message)) return;
    if (!ready || sink === undefined) return;
    const decoded = decodeChannelMessage(message);
    if (decoded === undefined || decoded.channel !== inputChannel) return;

    if (decoded.kind === "note") {
      const source = `note:${decoded.channel}:${decoded.number}`;
      if (shiftNotes.has(decoded.number)) {
        updateShift(source, decoded.pressed);
        return;
      }

      const action = noteActions[decoded.number];
      if (action !== undefined && action !== null) {
        updateAction(source, action, decoded.pressed);
        return;
      }

      const key = notes[decoded.number];
      if (key !== undefined && key !== null) {
        updateControl(source, { kind: "key", key }, decoded.pressed);
      }
      return;
    }

    const source = `cc:${decoded.channel}:${decoded.number}`;
    if (shiftButtons.has(decoded.number)) {
      updateShift(source, decoded.value > 0);
      return;
    }

    const action = buttonActions[decoded.number];
    if (action !== undefined && action !== null) {
      updateAction(source, action, decoded.value > 0);
      return;
    }

    const encoder = encoders.get(decoded.number);
    if (encoder !== undefined) {
      handleEncoder(encoder, decoded.value);
      return;
    }

    const key = buttons[decoded.number];
    if (key !== undefined && key !== null) {
      updateControl(
        source,
        { kind: "key", key },
        decoded.value > 0,
      );
      return;
    }

    const direction = joystick[decoded.number];
    if (direction !== undefined && direction !== null) {
      updateControl(
        source,
        { kind: "joystick", direction },
        decoded.value > 0,
      );
    }
  }

  function handleEncoder(encoder: RelativeEncoder, value: number): void {
    if (sink === undefined) return;
    const direction = encoder.clockwise.includes(value)
      ? "clockwise"
      : encoder.counterClockwise.includes(value)
        ? "counterClockwise"
        : undefined;
    if (direction === undefined) return;

    const timestamp = Date.now();
    const previous = encoderStates.get(encoder.cc);
    if (previous !== undefined && timestamp - previous.lastStepAt < encoder.minStepIntervalMs) {
      return;
    }

    const continues =
      previous?.direction === direction &&
      timestamp - previous.lastPulseAt <= encoder.pulseSequenceTimeoutMs;
    const pulses = continues ? previous.pulses + 1 : 1;
    const lastStepAt = previous?.lastStepAt ?? Number.NEGATIVE_INFINITY;
    if (pulses < encoder.pulsesPerStep) {
      encoderStates.set(encoder.cc, {
        direction,
        pulses,
        lastPulseAt: timestamp,
        lastStepAt,
      });
      return;
    }

    encoderStates.set(encoder.cc, {
      direction,
      pulses: 0,
      lastPulseAt: timestamp,
      lastStepAt: timestamp,
    });
    emitEncoderTarget(encoder.targets[direction], encoder.cc, direction);
  }

  function emitEncoderTarget(
    target: EncoderTarget,
    cc: number,
    direction: EncoderState["direction"],
  ): void {
    if (target.type === "app-action") {
      dispatchAppAction(target.action);
      return;
    }
    if (sink !== undefined) {
      dispatch(sink.emitKey({ key: target.key, act: 2 }), `encoder CC ${cc} ${direction}`);
    }
  }

  function updateShift(source: string, pressed: boolean): void {
    if (pressed) heldShiftSources.add(source);
    else heldShiftSources.delete(source);
    shiftPressed = heldShiftSources.size > 0;
  }

  function updateAction(
    source: string,
    binding: MidiActionBinding,
    pressed: boolean,
  ): void {
    if (!pressed) {
      heldActionSources.delete(source);
      return;
    }
    if (heldActionSources.has(source)) return;
    heldActionSources.add(source);
    dispatchAppAction(shiftPressed ? (binding.shifted ?? binding.press) : binding.press);
  }

  function updateControl(id: string, target: LogicalTarget, pressed: boolean): void {
    const previousId = heldControls.get(id);
    const logicalId = target.kind === "key"
      ? `key:${target.key}`
      : `joystick:${target.direction}`;

    if (pressed) {
      if (previousId === logicalId) return;
      if (previousId !== undefined) releaseTarget(previousId);
      heldControls.set(id, logicalId);

      const held = heldTargets.get(logicalId);
      if (held !== undefined) {
        held.count += 1;
      } else {
        heldTargets.set(logicalId, { target, count: 1 });
        emitTarget(target, true);
      }
      return;
    }

    if (previousId === undefined) return;
    heldControls.delete(id);
    releaseTarget(previousId);
  }

  function releaseTarget(id: string): void {
    const held = heldTargets.get(id);
    if (held === undefined) return;
    if (held.count > 1) {
      held.count -= 1;
      return;
    }
    heldTargets.delete(id);
    emitTarget(held.target, false);
  }

  function emitTarget(target: LogicalTarget, pressed: boolean): void {
    if (sink === undefined) return;
    if (target.kind === "key") {
      dispatch(
        sink.emitKey({ key: target.key, act: pressed ? 1 : 0 }),
        `${target.key} ${pressed ? "press" : "release"}`,
      );
      return;
    }
    dispatch(
      sink.emitJoystick({
        angle: JOYSTICK_POSITIONS[target.direction],
        distance: pressed ? 1 : 0,
      }),
      `joystick ${target.direction} ${pressed ? "press" : "release"}`,
    );
  }

  function releaseHeldControls(): void {
    for (const { target } of heldTargets.values()) emitTarget(target, false);
    heldControls.clear();
    heldTargets.clear();
    heldActionSources.clear();
    heldShiftSources.clear();
    encoderStates.clear();
    shiftPressed = false;
  }

  function replayLighting(): void {
    if (!ready || latestLighting === undefined || profile.renderLighting === undefined) return;
    let frames: readonly LightingFrame[];
    try {
      frames = profile.renderLighting(latestLighting);
      for (const frame of frames) {
        const rendered = JSON.stringify(frame.messages);
        if (renderedLighting.get(frame.id) === rendered) continue;
        for (const message of frame.messages) connection.send(message);
        renderedLighting.set(frame.id, rendered);
      }
    } catch (error) {
      warnConnectionFailure(
        "lighting",
        `${profile.displayName} lighting write failed; reconnecting`,
        error,
      );
      closeConnection("error");
    }
  }

  function closeConnection(reason: DisconnectReason): void {
    if (closing || (input === undefined && output === undefined)) return;
    closing = true;
    try {
      try {
        session?.disconnect?.(reason, connection);
      } catch (error) {
        logger.debug(`${profile.displayName} disconnect hook failed`, error);
      }
      const previousInput = input;
      const previousOutput = output;
      input = undefined;
      output = undefined;
      ready = false;
      releaseHeldControls();
      renderedLighting.clear();
      closeMidiHandles(previousInput, previousOutput);
    } finally {
      closing = false;
    }
  }

  function dispatch(operation: Promise<void>, label: string): void {
    operation.catch((error: unknown) => {
      logger.warn(`Could not deliver ${profile.displayName} ${label} event`, error);
    });
  }

  function dispatchAppAction(action: CodexAppAction): void {
    context.appActions.dispatch(action).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`App action ${action} was unavailable: ${message}`);
    });
  }

  function closeMidiHandles(
    inputHandle?: MidiInputHandle,
    outputHandle?: MidiOutputHandle,
  ): void {
    try {
      inputHandle?.close();
    } catch (error) {
      logger.debug(`${profile.displayName} MIDI input cleanup failed`, error);
    }
    try {
      outputHandle?.close();
    } catch (error) {
      logger.debug(`${profile.displayName} MIDI output cleanup failed`, error);
    }
  }
}

type DecodedChannelMessage =
  | {
      readonly kind: "note";
      readonly channel: number;
      readonly number: number;
      readonly value: number;
      readonly pressed: boolean;
    }
  | {
      readonly kind: "cc";
      readonly channel: number;
      readonly number: number;
      readonly value: number;
    };

function decodeChannelMessage(message: MidiMessage): DecodedChannelMessage | undefined {
  if (message.length < 3) return undefined;
  const [status, number, value] = message;
  if (status === undefined || number === undefined || value === undefined) return undefined;
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  if (kind === 0x90 || kind === 0x80) {
    return {
      kind: "note",
      channel,
      number,
      value,
      pressed: kind === 0x90 && value > 0,
    };
  }
  if (kind === 0xb0) return { kind: "cc", channel, number, value };
  return undefined;
}

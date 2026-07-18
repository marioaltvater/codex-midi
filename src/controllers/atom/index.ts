/**
 * Complete PreSonus ATOM profile: physical mappings, relative encoder format,
 * native-mode handshake, and the controller's four-message RGB protocol.
 */

import {
  OFF_ZONE,
  type CodexButtonKey,
  type CodexLightingState,
  type ThreadLighting,
  type ZoneLighting,
} from "../../core/codex-micro.js";
import type { MidiMessage } from "../../midi/index.js";
import type {
  ControllerConnection,
  ControllerSession,
  LightingFrame,
  MidiControllerProfile,
  MidiMapping,
} from "../controller-profile.js";

/**
 * ATOM pads count from the bottom-left (note 36) to the top-right (51).
 * Repeating a destination is an alias; null pads are deliberately kept dark.
 */
const ATOM_MAPPING = {
  notes: {
    36: null,
    37: "ACT10",
    38: "ACT10",
    39: "ACT12",
    40: "ACT06",
    41: "ACT07",
    42: "ACT08",
    43: "ACT09",
    44: "AG02",
    45: "AG03",
    46: "AG04",
    47: "AG05",
    48: null,
    49: "AG00",
    50: "AG01",
    51: null,
  },
  buttons: {
    85: "ENC", // Set Loop
    86: "ENC", // Song Setup
    103: "ENC", // Select
    105: "ENC", // Click / Count In
  },
  joystick: {
    27: "up",
    29: "down",
    87: "up",
    89: "down",
    90: "left",
    102: "right",
  },
} satisfies MidiMapping;

const NATIVE_MODE_OFF: MidiMessage = [0x8f, 0x00, 0x00];
const NATIVE_MODE_ON: MidiMessage = [0x8f, 0x00, 0x7f];
const NATIVE_MODE_REPLY: MidiMessage = [0xbf, 0x7f, 0x7f];
const ACK_TIMEOUT_MS = 2_000;

const FIRST_PAD = 36;
const LAST_PAD = 51;
const INACTIVE_AGENT_BRIGHTNESS = 0.3;
const AUTO_DIM_BRIGHTNESS = 0.2;
const COMPLETED_THREAD_COLOR = 0x00ff00;
const STEADY_LIGHTING = {
  effect: 1,
  brightness: 1,
  speed: 0,
  magic: 0,
} as const;
const ACTION_LIGHTING: Partial<Record<CodexButtonKey, ZoneLighting>> = {
  ACT06: { ...STEADY_LIGHTING, color: 0xffff00 }, // Fast
  ACT07: { ...STEADY_LIGHTING, color: 0x00ff00 }, // Accept
  ACT08: { ...STEADY_LIGHTING, color: 0xff0000 }, // Reject
  ACT09: { ...STEADY_LIGHTING, color: 0x640064 }, // Fork task
  ACT10: { ...STEADY_LIGHTING, color: 0xffffff }, // Microphone
  ACT12: { ...STEADY_LIGHTING, color: 0x3232ff }, // Submit
};
const AUTO_DIM_TASK_LIGHTING: ZoneLighting = {
  ...STEADY_LIGHTING,
  brightness: AUTO_DIM_BRIGHTNESS,
  color: 0xffffff,
};

const ATOM_PROFILE = {
  displayName: "PreSonus ATOM",
  ports: { input: "ATOM", output: "ATOM" },
  inputChannel: 0,
  mapping: ATOM_MAPPING,
  encoder: {
    cc: 14,
    clockwise: [65],
    counterClockwise: [1],
    pulsesPerStep: 5,
    minStepIntervalMs: 333,
    pulseSequenceTimeoutMs: 500,
  },
  createSession: createAtomNativeModeSession,
  renderLighting: renderAtomPadLighting,
} satisfies MidiControllerProfile;

export default ATOM_PROFILE;

function createAtomNativeModeSession(): ControllerSession {
  let connection: ControllerConnection | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let verified = false;

  return {
    connect(nextConnection) {
      connection = nextConnection;
      attempts = 0;
      verified = false;
      requestNativeMode();
    },

    handleMessage(message) {
      if (
        message.length !== NATIVE_MODE_REPLY.length ||
        !message.every((value, index) => value === NATIVE_MODE_REPLY[index])
      ) {
        return false;
      }
      markReady(true);
      return true;
    },

    disconnect(reason, activeConnection) {
      clearTimer();
      if (reason === "stopped") activeConnection.send(NATIVE_MODE_OFF);
      connection = undefined;
      attempts = 0;
      verified = false;
    },
  };

  function requestNativeMode(): void {
    const active = connection;
    if (active === undefined) return;
    clearTimer();
    attempts += 1;
    timer = setTimeout(handleAckTimeout, ACK_TIMEOUT_MS);
    try {
      active.send(NATIVE_MODE_OFF);
      active.send(NATIVE_MODE_ON);
    } catch {
      clearTimer();
      active.reconnect();
    }
  }

  function handleAckTimeout(): void {
    timer = undefined;
    const active = connection;
    if (active === undefined) return;
    if (attempts < 2) {
      active.logger.warn("ATOM native-mode acknowledgement timed out; retrying once");
      requestNativeMode();
      return;
    }
    active.logger.warn("ATOM native mode is unverified; continuing without its acknowledgement");
    markReady(false);
  }

  function markReady(acknowledged: boolean): void {
    const active = connection;
    if (active === undefined) return;
    clearTimer();
    if (acknowledged && !verified) active.logger.info("ATOM native mode is ready");
    if (acknowledged) verified = true;
    attempts = 0;
    active.ready();
  }

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
}

function renderAtomPadLighting(state: Readonly<CodexLightingState>): LightingFrame[] {
  const autoDimmed = !state.threads.some(
    (thread) => thread.effect !== 0 && thread.color !== 0 && thread.brightness > 0,
  );
  const selected = state.threads.findIndex(
    (thread) => thread.effect === 4 && thread.color !== 0 && thread.brightness > 0,
  );

  return Array.from({ length: LAST_PAD - FIRST_PAD + 1 }, (_, index) => {
    const note = FIRST_PAD + index;
    const key = ATOM_MAPPING.notes[note as keyof typeof ATOM_MAPPING.notes];
    let lighting: ThreadLighting | ZoneLighting = OFF_ZONE;
    if (typeof key === "string" && /^AG0[0-5]$/.test(key)) {
      const slot = Number(key.at(-1));
      const thread = state.threads[slot];
      if (autoDimmed) {
        lighting = {
          ...AUTO_DIM_TASK_LIGHTING,
          color: correctAtomThreadColor(thread?.color ?? 0) || AUTO_DIM_TASK_LIGHTING.color,
        };
      } else if (thread !== undefined) {
        const corrected = { ...thread, color: correctAtomThreadColor(thread.color) };
        lighting = slot === selected ? corrected : dimInactiveThread(corrected);
      }
    } else if (typeof key === "string") {
      const action = ACTION_LIGHTING[key];
      if (action !== undefined) {
        lighting = autoDimmed
          ? { ...action, brightness: action.brightness * AUTO_DIM_BRIGHTNESS }
          : action;
      }
    }

    const rendered = renderPad(lighting);
    return {
      id: `pad:${note}`,
      messages: [
        [0x90, note, rendered.state],
        [0x91, note, rendered.red],
        [0x92, note, rendered.green],
        [0x93, note, rendered.blue],
      ],
    };
  });
}

function correctAtomThreadColor(color: number): number {
  const red = (color >>> 16) & 0xff;
  const green = (color >>> 8) & 0xff;
  const blue = color & 0xff;
  return green > red && green > blue ? COMPLETED_THREAD_COLOR : color;
}

function dimInactiveThread(thread: ThreadLighting): ThreadLighting {
  if (thread.effect === 0 || thread.color === 0 || thread.brightness === 0) return thread;
  return { ...thread, brightness: thread.brightness * INACTIVE_AGENT_BRIGHTNESS };
}

function renderPad(lighting: ThreadLighting | ZoneLighting) {
  const brightness = Math.min(1, Math.max(0, lighting.brightness));
  const color = Math.trunc(Math.min(0xffffff, Math.max(0, lighting.color)));
  const component = (value: number) => Math.round((value / 255) * 127 * brightness);
  const off = lighting.effect === 0 || brightness === 0 || color === 0;
  let state = 127;
  if (off) state = 0;
  else if (lighting.effect === 4 || lighting.effect === 6) state = 2;
  else if (lighting.effect === 2 || lighting.effect === 3) state = 1;
  return {
    red: component((color >>> 16) & 0xff),
    green: component((color >>> 8) & 0xff),
    blue: component(color & 0xff),
    state,
  };
}

import { afterEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import {
  emptyLightingState,
  type CodexJoystickEvent,
  type CodexKeyEvent,
} from "../src/core/codex-micro.js";
import type { CodexAppAction } from "../src/controllers/controller.js";
import { createController, listControllerIds } from "../src/controllers/index.js";
import { createMidiSurface } from "../src/controllers/midi-surface.js";
import type {
  ControllerConnection,
  ControllerSession,
  MidiControllerProfile,
} from "../src/controllers/midi-profile.js";
import {
  createMidiTestBackend,
  flushPromises,
  quietLogger,
} from "./midi-test-backend.js";

const profile = {
  displayName: "Test controller",
  ports: { input: "Test In", output: "Test Out" },
  inputChannel: 0,
  mapping: {
    notes: { 36: "ACT06", 37: "ACT06" },
    buttons: { 10: "ENC" },
    joystick: { 20: "up", 21: "up" },
    shift: { notes: [60], buttons: [32] },
    actions: {
      notes: {
        40: { press: "previous-task", shifted: "next-task" },
      },
      buttons: {
        29: { press: "toggle-left-sidebar", shifted: "toggle-review-panel" },
        30: { press: "toggle-plan-mode" },
      },
    },
  },
  encoders: [
    {
      cc: 14,
      clockwise: [1],
      counterClockwise: [65],
      targets: {
        clockwise: { type: "micro-key", key: "ENC_CW" },
        counterClockwise: { type: "micro-key", key: "ENC_CC" },
      },
      pulsesPerStep: 2,
      minStepIntervalMs: 100,
      pulseSequenceTimeoutMs: 50,
    },
    {
      cc: 15,
      clockwise: [1],
      counterClockwise: [65],
      targets: {
        clockwise: { type: "app-action", action: "next-task" },
        counterClockwise: { type: "app-action", action: "previous-task" },
      },
      pulsesPerStep: 2,
      minStepIntervalMs: 100,
      pulseSequenceTimeoutMs: 50,
    },
  ],
  renderLighting(state) {
    return [{ id: "status", messages: [[0x90, 1, Math.round(state.keys.brightness * 127)]] }];
  },
} satisfies MidiControllerProfile;

const noopAppActions = { async dispatch() {} };

afterEach(() => {
  setSystemTime();
  if (jest.isFakeTimers()) jest.useRealTimers();
});

describe("MIDI controller", () => {
  test("treats zero-velocity Note-On as a release", async () => {
    const fixture = await startFixture();
    fixture.midi.emit([0x90, 36, 127]);
    fixture.midi.emit([0x90, 36, 0]);
    await flushPromises();
    expect(fixture.keys).toEqual([
      { key: "ACT06", act: 1 },
      { key: "ACT06", act: 0 },
    ]);
    await fixture.surface.stop();
  });

  test("emits final releases only after every key and joystick alias is released", async () => {
    const fixture = await startFixture();
    fixture.midi.emit([0x90, 36, 127]);
    fixture.midi.emit([0x90, 37, 127]);
    fixture.midi.emit([0x80, 36, 0]);
    fixture.midi.emit([0x80, 37, 0]);
    fixture.midi.emit([0xb0, 20, 127]);
    fixture.midi.emit([0xb0, 21, 127]);
    fixture.midi.emit([0xb0, 20, 0]);
    fixture.midi.emit([0xb0, 21, 0]);
    await flushPromises();

    expect(fixture.keys).toEqual([
      { key: "ACT06", act: 1 },
      { key: "ACT06", act: 0 },
    ]);
    expect(fixture.joystick).toEqual([
      { angle: 0.75, distance: 1 },
      { angle: 0.75, distance: 0 },
    ]);
    await fixture.surface.stop();
  });

  test("handles CC presses and releases", async () => {
    const fixture = await startFixture();
    fixture.midi.emit([0xb0, 10, 127]);
    fixture.midi.emit([0xb0, 10, 0]);
    await flushPromises();
    expect(fixture.keys).toEqual([
      { key: "ENC", act: 1 },
      { key: "ENC", act: 0 },
    ]);
    await fixture.surface.stop();
  });

  test("dispatches note and CC actions once per press with shift precedence and fallback", async () => {
    const fixture = await startFixture();

    fixture.midi.emit([0xb0, 29, 127]);
    fixture.midi.emit([0xb0, 29, 127]);
    fixture.midi.emit([0xb0, 29, 0]);

    fixture.midi.emit([0x90, 60, 127]);
    fixture.midi.emit([0xb0, 32, 127]);
    fixture.midi.emit([0x80, 60, 0]);
    fixture.midi.emit([0xb0, 29, 127]);
    fixture.midi.emit([0xb0, 29, 0]);
    fixture.midi.emit([0xb0, 30, 127]);
    fixture.midi.emit([0xb0, 30, 0]);
    fixture.midi.emit([0xb0, 32, 0]);

    fixture.midi.emit([0x90, 40, 127]);
    fixture.midi.emit([0x90, 40, 127]);
    fixture.midi.emit([0x80, 40, 0]);
    await flushPromises();

    expect(fixture.actions).toEqual([
      "toggle-left-sidebar",
      "toggle-review-panel",
      "toggle-plan-mode",
      "previous-task",
    ]);
    await fixture.surface.stop();
  });

  test("clears shift and held action sources across disconnects", async () => {
    const fixture = await startFixture();
    fixture.midi.emit([0xb0, 32, 127]);
    fixture.midi.emit([0xb0, 29, 127]);
    await flushPromises();
    expect(fixture.actions).toEqual(["toggle-review-panel"]);

    await fixture.surface.stop();
    fixture.actions.length = 0;
    await fixture.surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    fixture.midi.emit([0xb0, 29, 127]);
    await flushPromises();

    expect(fixture.actions).toEqual(["toggle-left-sidebar"]);
    await fixture.surface.stop();
  });

  test("gears relative encoders, normalizes direction, and rate-limits bursts", async () => {
    setSystemTime(1_000);
    const fixture = await startFixture();
    fixture.midi.emit([0xb0, 14, 1]);
    fixture.midi.emit([0xb0, 14, 1]);
    fixture.midi.emit([0xb0, 14, 1]);
    fixture.midi.emit([0xb0, 14, 1]);
    await flushPromises();
    expect(fixture.keys).toEqual([{ key: "ENC_CW", act: 2 }]);

    setSystemTime(1_101);
    fixture.midi.emit([0xb0, 14, 65]);
    fixture.midi.emit([0xb0, 14, 65]);
    await flushPromises();
    expect(fixture.keys.at(-1)).toEqual({ key: "ENC_CC", act: 2 });
    await fixture.surface.stop();
  });

  test("resets partial encoder motion after a direction change or sequence timeout", async () => {
    setSystemTime(1_000);
    const fixture = await startFixture();
    fixture.midi.emit([0xb0, 14, 1]);
    fixture.midi.emit([0xb0, 14, 65]);
    expect(fixture.keys).toEqual([]);
    fixture.midi.emit([0xb0, 14, 65]);
    await flushPromises();
    expect(fixture.keys).toEqual([{ key: "ENC_CC", act: 2 }]);

    setSystemTime(1_101);
    fixture.midi.emit([0xb0, 14, 1]);
    setSystemTime(1_152);
    fixture.midi.emit([0xb0, 14, 1]);
    expect(fixture.keys).toHaveLength(1);
    fixture.midi.emit([0xb0, 14, 1]);
    await flushPromises();
    expect(fixture.keys.at(-1)).toEqual({ key: "ENC_CW", act: 2 });
    await fixture.surface.stop();
  });

  test("paces multiple encoders independently and supports app-action targets", async () => {
    setSystemTime(1_000);
    const fixture = await startFixture();
    fixture.midi.emit([0xb0, 14, 1]);
    fixture.midi.emit([0xb0, 15, 1]);
    fixture.midi.emit([0xb0, 14, 1]);
    fixture.midi.emit([0xb0, 15, 1]);
    await flushPromises();

    expect(fixture.keys).toEqual([{ key: "ENC_CW", act: 2 }]);
    expect(fixture.actions).toEqual(["next-task"]);

    setSystemTime(1_101);
    fixture.midi.emit([0xb0, 15, 65]);
    fixture.midi.emit([0xb0, 15, 65]);
    await flushPromises();
    expect(fixture.actions).toEqual(["next-task", "previous-task"]);
    await fixture.surface.stop();
  });

  test("keeps rejected app actions quiet without reconnecting MIDI", async () => {
    const midi = createMidiTestBackend();
    const debug = jest.fn();
    const warn = jest.fn();
    const surface = createMidiSurface(
      profile,
      { type: "test" },
      {
        logger: { ...quietLogger, debug, warn },
        appActions: { async dispatch() { throw new Error("action unavailable"); } },
      },
      midi.backend,
    );
    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    midi.emit([0xb0, 29, 127]);
    await flushPromises();

    expect(debug).toHaveBeenCalledWith(
      "App action toggle-left-sidebar was unavailable: action unavailable",
    );
    expect(warn).not.toHaveBeenCalled();
    expect(midi.state.inputOpens).toBe(1);
    expect(midi.state.inputCloses).toBe(0);
    await surface.stop();
  });

  test("forces held controls up when the surface disconnects", async () => {
    const fixture = await startFixture();
    fixture.midi.emit([0x90, 36, 127]);
    fixture.midi.emit([0xb0, 20, 127]);
    await flushPromises();
    await fixture.surface.stop();
    await flushPromises();
    expect(fixture.keys.at(-1)).toEqual({ key: "ACT06", act: 0 });
    expect(fixture.joystick.at(-1)).toEqual({ angle: 0.75, distance: 0 });
  });

  test("sends only changed lighting and replays it after reconnect", async () => {
    jest.useFakeTimers();
    const fixture = await startFixture();
    const lighting = emptyLightingState();
    lighting.keys.brightness = 0.5;
    await fixture.surface.applyFeedback?.(lighting);
    await fixture.surface.applyFeedback?.(lighting);
    expect(fixture.midi.state.sent).toEqual([[0x90, 1, 64]]);

    const changedLighting = emptyLightingState();
    changedLighting.keys.brightness = 0.25;
    await fixture.surface.applyFeedback?.(changedLighting);
    expect(fixture.midi.state.sent).toEqual([
      [0x90, 1, 64],
      [0x90, 1, 32],
    ]);

    fixture.midi.dropConnection();
    await advanceReconnect(2);
    expect(fixture.midi.state.inputCloses).toBeGreaterThanOrEqual(1);
    expect(fixture.midi.state.outputCloses).toBeGreaterThanOrEqual(1);
    expect(fixture.midi.state.sent).toEqual([
      [0x90, 1, 64],
      [0x90, 1, 32],
      [0x90, 1, 32],
    ]);
    await fixture.surface.stop();
  });

  test("reconnects and replays lighting after an output write fails", async () => {
    jest.useFakeTimers();
    const fixture = await startFixture();
    fixture.midi.state.sendFailures = 1;
    const lighting = emptyLightingState();
    lighting.keys.brightness = 1;
    await fixture.surface.applyFeedback?.(lighting);
    await advanceReconnect();
    expect(fixture.midi.state.sent).toEqual([[0x90, 1, 127]]);
    await fixture.surface.stop();
  });

  test("reports persistent lighting failures once while reconnecting", async () => {
    jest.useFakeTimers();
    const midi = createMidiTestBackend();
    const info = jest.fn();
    const warn = jest.fn();
    const surface = createMidiSurface(
      profile,
      { type: "test" },
      { logger: { ...quietLogger, info, warn }, appActions: noopAppActions },
      midi.backend,
    );
    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });

    midi.state.sendFailures = Number.POSITIVE_INFINITY;
    const lighting = emptyLightingState();
    lighting.keys.brightness = 1;
    await surface.applyFeedback?.(lighting);
    await advanceReconnect(2);

    expect(midi.state.inputOpens).toBe(3);
    expect(midi.state.inputCloses).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    await surface.stop();
  });

  test("closes a partially opened input when output opening fails", async () => {
    const midi = createMidiTestBackend();
    midi.state.failOutput = true;
    const surface = createMidiSurface(
      profile,
      { type: "test" },
      { logger: quietLogger, appActions: noopAppActions },
      midi.backend,
    );
    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    expect(midi.state.inputCloses).toBe(1);
    await surface.stop();
  });

  test("supports input-only profiles without opening a MIDI output", async () => {
    const midi = createMidiTestBackend();
    const inputOnly = {
      displayName: "Input only",
      ports: { input: "Test In" },
      mapping: { notes: { 36: "ACT06" } },
    } satisfies MidiControllerProfile;
    const keys: CodexKeyEvent[] = [];
    const surface = createMidiSurface(
      inputOnly,
      { type: "input-only" },
      { logger: quietLogger, appActions: noopAppActions },
      midi.backend,
    );
    await surface.start({
      emitKey: async (event) => { keys.push(event); },
      emitJoystick: async () => {},
    });
    midi.emit([0x90, 36, 127]);
    await flushPromises();
    expect(keys).toEqual([{ key: "ACT06", act: 1 }]);
    expect(midi.state.outputOpens).toBe(0);
    await surface.stop();
  });

  test("does not open ports or install reconnect work after stop wins a startup race", async () => {
    const midi = createMidiTestBackend();
    let releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => { releaseList = resolve; });
    const listPorts = midi.backend.listPorts;
    midi.backend.listPorts = async () => {
      await listGate;
      return listPorts();
    };
    const surface = createMidiSurface(
      profile,
      { type: "test" },
      { logger: quietLogger, appActions: noopAppActions },
      midi.backend,
    );
    const starting = surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    await flushPromises();
    await surface.stop();
    releaseList();
    await starting;
    await flushPromises();
    expect(midi.state.inputOpens).toBe(0);
    expect(midi.state.outputOpens).toBe(0);
  });

  test("recovers after transient port enumeration and handle-status failures", async () => {
    jest.useFakeTimers();
    const midi = createMidiTestBackend();
    midi.state.listFailures = 1;
    const surface = createMidiSurface(
      profile,
      { type: "test" },
      { logger: quietLogger, appActions: noopAppActions },
      midi.backend,
    );
    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    expect(midi.state.inputOpens).toBe(0);
    await advanceReconnect();
    expect(midi.state.inputOpens).toBe(1);

    midi.state.inputStatusFailures = 1;
    await advanceReconnect(2);
    expect(midi.state.outputOpens).toBe(2);
    expect(midi.state.inputCloses).toBeGreaterThanOrEqual(1);
    await surface.stop();
  });

  test("keeps retrying while reporting a continuous enumeration failure once", async () => {
    jest.useFakeTimers();
    const midi = createMidiTestBackend();
    const warn = jest.fn();
    midi.state.listFailures = Number.POSITIVE_INFINITY;
    const surface = createMidiSurface(
      profile,
      { type: "test" },
      { logger: { ...quietLogger, warn }, appActions: noopAppActions },
      midi.backend,
    );

    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    await advanceReconnect(3);

    expect(midi.state.listCalls).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
    await surface.stop();

    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    expect(midi.state.listCalls).toBe(5);
    expect(warn).toHaveBeenCalledTimes(2);
    await surface.stop();
  });

  test("reports changed failures and reports the same failure again after recovery", async () => {
    jest.useFakeTimers();
    const midi = createMidiTestBackend();
    const warn = jest.fn();
    midi.state.listFailures = 1;
    midi.state.failOutput = true;
    const surface = createMidiSurface(
      profile,
      { type: "test" },
      { logger: { ...quietLogger, warn }, appActions: noopAppActions },
      midi.backend,
    );

    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    await advanceReconnect(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(midi.state.inputOpens).toBe(2);
    expect(midi.state.inputCloses).toBe(2);

    midi.state.failOutput = false;
    await advanceReconnect();
    midi.dropConnection();
    midi.state.failOutput = true;
    await advanceReconnect(2);

    expect(warn).toHaveBeenCalledTimes(3);
    await surface.stop();
  });

  test("does not announce connections when a session immediately requests a reconnect", async () => {
    jest.useFakeTimers();
    const fixture = await startSessionFailureFixture(() => ({
      connect(connection) { connection.reconnect(); },
    }));
    await advanceReconnect(2);

    expect(fixture.midi.state.inputOpens).toBe(3);
    expect(fixture.midi.state.inputCloses).toBe(3);
    expect(fixture.warn).toHaveBeenCalledTimes(1);
    expect(fixture.info).not.toHaveBeenCalled();
    await fixture.surface.stop();
  });

  test("does not repeat warnings while a session reconnects asynchronously before ready", async () => {
    jest.useFakeTimers();
    const fixture = await startSessionFailureFixture(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        connect(connection) {
          timer = setTimeout(() => connection.reconnect(), 100);
        },
        disconnect() {
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
        },
      };
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      jest.advanceTimersByTime(100);
      await flushPromises();
      if (attempt < 2) {
        await advanceReconnect();
      }
    }

    expect(fixture.midi.state.inputOpens).toBe(3);
    expect(fixture.midi.state.inputCloses).toBe(3);
    expect(fixture.warn).toHaveBeenCalledTimes(1);
    expect(fixture.info).not.toHaveBeenCalled();
    await fixture.surface.stop();
  });

  test("reports a repeatedly thrown session connection once", async () => {
    jest.useFakeTimers();
    const fixture = await startSessionFailureFixture(() => ({
      connect() { throw new Error("session failed"); },
    }));
    await advanceReconnect(2);

    expect(fixture.midi.state.inputOpens).toBe(3);
    expect(fixture.midi.state.inputCloses).toBe(3);
    expect(fixture.warn).toHaveBeenCalledTimes(1);
    expect(fixture.info).not.toHaveBeenCalled();
    await fixture.surface.stop();
  });

  test("cleans up every candidate handle when stop wins output opening", async () => {
    const midi = createMidiTestBackend();
    midi.state.throwInputClose = true;
    let releaseOutput!: () => void;
    const outputGate = new Promise<void>((resolve) => { releaseOutput = resolve; });
    let markOutputStarted!: () => void;
    const outputStarted = new Promise<void>((resolve) => { markOutputStarted = resolve; });
    const openOutput = midi.backend.openOutput;
    midi.backend.openOutput = async (name) => {
      markOutputStarted();
      await outputGate;
      return openOutput(name);
    };
    const surface = createMidiSurface(
      profile,
      { type: "test" },
      { logger: quietLogger, appActions: noopAppActions },
      midi.backend,
    );
    const starting = surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    await outputStarted;
    await surface.stop();
    releaseOutput();
    await starting;
    expect(midi.state.inputCloses).toBe(1);
    expect(midi.state.outputCloses).toBe(1);
  });

  test("reconnects when a controller-local decoder throws", async () => {
    jest.useFakeTimers();
    const throwingProfile = {
      ...profile,
      createSession() {
        return {
          connect(connection) { connection.ready(); },
          handleMessage() { throw new Error("bad vendor frame"); },
        };
      },
    } satisfies MidiControllerProfile;
    const midi = createMidiTestBackend();
    const surface = createMidiSurface(
      throwingProfile,
      { type: "test" },
      { logger: quietLogger, appActions: noopAppActions },
      midi.backend,
    );
    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    midi.emit([0xf0, 0x01, 0xf7]);
    await advanceReconnect();
    expect(midi.state.outputOpens).toBe(2);
    expect(midi.state.inputCloses).toBeGreaterThanOrEqual(1);
    await surface.stop();
  });

  test("lets a controller session dispatch a semantic app action", async () => {
    const midi = createMidiTestBackend();
    const actions: CodexAppAction[] = [];
    const sessionProfile = {
      ...profile,
      createSession() {
        let connection: ControllerConnection | undefined;
        return {
          connect(nextConnection) {
            connection = nextConnection;
            connection.ready();
          },
          handleMessage(message) {
            if (message[0] !== 0xf0) return false;
            connection?.dispatchAction("open-codex-micro-settings");
            return true;
          },
        };
      },
    } satisfies MidiControllerProfile;
    const surface = createMidiSurface(
      sessionProfile,
      { type: "test" },
      {
        logger: quietLogger,
        appActions: { async dispatch(action) { actions.push(action); } },
      },
      midi.backend,
    );
    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    midi.emit([0xf0, 0x01, 0xf7]);
    await flushPromises();

    expect(actions).toEqual(["open-codex-micro-settings"]);
    expect(midi.state.inputOpens).toBe(1);
    await surface.stop();
  });
});

describe("controller registry", () => {
  test("lists and constructs registered profiles", () => {
    expect(listControllerIds()).toEqual(["atom"]);
    const controller = createController(
      { type: "atom" },
      { logger: quietLogger, appActions: noopAppActions },
    );
    expect(controller.displayName).toBe("PreSonus ATOM");
  });

  test("rejects unknown controller types", () => {
    expect(() => createController(
      { type: "unknown" },
      { logger: quietLogger, appActions: noopAppActions },
    )).toThrow(
      'Unknown controller type "unknown". Available types: atom',
    );
  });

  test("uses exact input and output port overrides", async () => {
    const midi = createMidiTestBackend({ inputs: ["Custom In"], outputs: ["Custom Out"] });
    const surface = createMidiSurface(profile, {
      type: "test",
      inputName: "Custom In",
      outputName: "Custom Out",
    }, { logger: quietLogger, appActions: noopAppActions }, midi.backend);
    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    expect(midi.state.openedNames).toEqual(["Custom In", "Custom Out"]);
    await surface.stop();
  });

  test("does not copy an input override onto a distinct output port", async () => {
    const midi = createMidiTestBackend({ inputs: ["Custom In"], outputs: ["Test Out"] });
    const surface = createMidiSurface(profile, {
      type: "test",
      inputName: "Custom In",
    }, { logger: quietLogger, appActions: noopAppActions }, midi.backend);
    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    expect(midi.state.openedNames).toEqual(["Custom In", "Test Out"]);
    await surface.stop();
  });

  test("uses one override for matching input and output port names", async () => {
    const midi = createMidiTestBackend({ inputs: ["Custom Port"], outputs: ["Custom Port"] });
    const sharedPortProfile = {
      ...profile,
      ports: { input: "Default Port", output: "Default Port" },
    } satisfies MidiControllerProfile;
    const surface = createMidiSurface(
      sharedPortProfile,
      { type: "test", inputName: "Custom Port" },
      { logger: quietLogger, appActions: noopAppActions },
      midi.backend,
    );
    await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
    expect(midi.state.openedNames).toEqual(["Custom Port", "Custom Port"]);
    await surface.stop();
  });
});

async function startFixture() {
  const midi = createMidiTestBackend();
  const keys: CodexKeyEvent[] = [];
  const joystick: CodexJoystickEvent[] = [];
  const actions: CodexAppAction[] = [];
  const surface = createMidiSurface(
    profile,
    { type: "test" },
    {
      logger: quietLogger,
      appActions: { async dispatch(action) { actions.push(action); } },
    },
    midi.backend,
  );
  await surface.start({
    emitKey: async (event) => { keys.push(event); },
    emitJoystick: async (event) => { joystick.push(event); },
  });
  return { midi, keys, joystick, actions, surface };
}

async function startSessionFailureFixture(createSession: () => ControllerSession) {
  const midi = createMidiTestBackend();
  const info = jest.fn();
  const warn = jest.fn();
  const surface = createMidiSurface(
    { ...profile, createSession },
    { type: "test" },
    { logger: { ...quietLogger, info, warn }, appActions: noopAppActions },
    midi.backend,
  );
  await surface.start({ emitKey: async () => {}, emitJoystick: async () => {} });
  return { midi, info, warn, surface };
}

async function advanceReconnect(cycles = 1): Promise<void> {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    jest.advanceTimersByTime(1_000);
    await flushPromises();
  }
}

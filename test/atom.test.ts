import { afterEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import { createController } from "../src/controllers/index.js";
import {
  emptyLightingState,
  type CodexJoystickEvent,
  type CodexKeyEvent,
} from "../src/core/codex-micro.js";
import { createMidiTestBackend, flushPromises, quietLogger } from "./midi-test-backend.js";

const NATIVE_MODE_OFF = [0x8f, 0x00, 0x00];
const NATIVE_MODE_ON = [0x8f, 0x00, 0x7f];
const NATIVE_MODE_REPLY = [0xbf, 0x7f, 0x7f];

afterEach(() => {
  setSystemTime();
  if (jest.isFakeTimers()) jest.useRealTimers();
});

describe("ATOM controller", () => {
  test("exposes every mapped control through public controller construction", async () => {
    const fixture = await startAtom();
    expect(fixture.displayName).toBe("PreSonus ATOM");
    expect(fixture.midi.state.sent).toEqual([NATIVE_MODE_OFF, NATIVE_MODE_ON]);

    fixture.midi.emit([0x90, 40, 127]);
    fixture.midi.emit([0x80, 40, 0]);
    await fixture.surface.applyLighting(emptyLightingState());
    await flushPromises();
    expect(fixture.keys).toEqual([]);
    expect(fixture.midi.state.sent).toEqual([NATIVE_MODE_OFF, NATIVE_MODE_ON]);

    fixture.midi.emit(NATIVE_MODE_REPLY);
    expect(fixture.midi.state.sent).toHaveLength(2 + 16 * 4);

    const pads = [
      [49, "AG00"], [50, "AG01"], [44, "AG02"], [45, "AG03"],
      [46, "AG04"], [47, "AG05"], [40, "ACT06"], [41, "ACT07"],
      [42, "ACT08"], [43, "ACT09"], [37, "ACT10"], [38, "ACT10"],
      [39, "ACT12"],
    ] as const;
    for (const [note] of pads) {
      fixture.midi.emit([0x90, note, 127]);
      fixture.midi.emit([0x80, note, 0]);
    }
    for (const note of [36, 48, 51]) {
      fixture.midi.emit([0x90, note, 127]);
      fixture.midi.emit([0x80, note, 0]);
    }
    await flushPromises();

    expect(fixture.keys).toEqual(
      pads.flatMap(([, key]) => [{ key, act: 1 }, { key, act: 0 }]),
    );

    for (const cc of [85, 86, 103, 105]) {
      fixture.midi.emit([0xb0, cc, 127]);
      fixture.midi.emit([0xb0, cc, 0]);
    }
    await flushPromises();
    expect(fixture.keys.slice(-8)).toEqual(
      [85, 86, 103, 105].flatMap(() => [
        { key: "ENC", act: 1 },
        { key: "ENC", act: 0 },
      ]),
    );

    fixture.midi.emit([0x90, 37, 127]);
    fixture.midi.emit([0x90, 38, 127]);
    fixture.midi.emit([0x80, 37, 0]);
    fixture.midi.emit([0x80, 38, 0]);
    await flushPromises();
    expect(fixture.keys.slice(-2)).toEqual([
      { key: "ACT10", act: 1 },
      { key: "ACT10", act: 0 },
    ]);
    await fixture.surface.stop();
    expect(fixture.midi.state.sent.at(-1)).toEqual(NATIVE_MODE_OFF);
  });

  test("reference-counts all joystick aliases", async () => {
    const fixture = await startAtom();
    fixture.midi.emit(NATIVE_MODE_REPLY);
    const directions = [
      [27, 0.75],
      [87, 0.75],
      [29, 0.25],
      [89, 0.25],
      [90, 0.5],
      [102, 0],
    ] as const;
    for (const [cc] of directions) {
      fixture.midi.emit([0xb0, cc, 127]);
      fixture.midi.emit([0xb0, cc, 0]);
    }
    await flushPromises();
    expect(fixture.joystick).toEqual(
      directions.flatMap(([, angle]) => [
        { angle, distance: 1 },
        { angle, distance: 0 },
      ]),
    );

    for (const cc of [27, 87]) fixture.midi.emit([0xb0, cc, 127]);
    for (const cc of [27, 87]) fixture.midi.emit([0xb0, cc, 0]);
    await flushPromises();
    expect(fixture.joystick.slice(-2)).toEqual([
      { angle: 0.75, distance: 1 },
      { angle: 0.75, distance: 0 },
    ]);
    await fixture.surface.stop();
  });

  test("aliases Set Loop and Song Setup to the Select click", async () => {
    const fixture = await startAtom();
    fixture.midi.emit(NATIVE_MODE_REPLY);
    for (const cc of [85, 86, 103]) fixture.midi.emit([0xb0, cc, 127]);
    for (const cc of [85, 86, 103]) fixture.midi.emit([0xb0, cc, 0]);
    await flushPromises();
    expect(fixture.keys).toEqual([
      { key: "ENC", act: 1 },
      { key: "ENC", act: 0 },
    ]);
    await fixture.surface.stop();
  });

  test("normalizes physical encoder directions and keeps adjacent detents responsive", async () => {
    setSystemTime(1_000);
    const fixture = await startAtom();
    fixture.midi.emit(NATIVE_MODE_REPLY);
    for (let pulse = 0; pulse < 10; pulse += 1) fixture.midi.emit([0xb0, 14, 65]);
    await flushPromises();
    expect(fixture.keys).toEqual([{ key: "ENC_CW", act: 2 }]);

    setSystemTime(1_050);
    for (let pulse = 0; pulse < 5; pulse += 1) fixture.midi.emit([0xb0, 14, 65]);
    await flushPromises();
    expect(fixture.keys.at(-1)).toEqual({ key: "ENC_CW", act: 2 });

    setSystemTime(1_100);
    for (let pulse = 0; pulse < 5; pulse += 1) fixture.midi.emit([0xb0, 14, 1]);
    await flushPromises();
    expect(fixture.keys.at(-1)).toEqual({ key: "ENC_CC", act: 2 });
    await fixture.surface.stop();
  });

  test("retries native-mode negotiation once and then accepts input unverified", async () => {
    jest.useFakeTimers();
    const fixture = await startAtom();
    expect(fixture.midi.state.sent).toEqual([NATIVE_MODE_OFF, NATIVE_MODE_ON]);

    await advanceTime(2_000);
    expect(fixture.midi.state.sent).toEqual([
      NATIVE_MODE_OFF,
      NATIVE_MODE_ON,
      NATIVE_MODE_OFF,
      NATIVE_MODE_ON,
    ]);
    await advanceTime(2_000);
    fixture.midi.emit([0x90, 40, 127]);
    fixture.midi.emit([0x80, 40, 0]);
    await flushPromises();
    expect(fixture.keys).toEqual([
      { key: "ACT06", act: 1 },
      { key: "ACT06", act: 0 },
    ]);
    await fixture.surface.stop();
  });

  test("does not replay lighting for duplicate native-mode acknowledgements", async () => {
    const fixture = await startAtom();
    await fixture.surface.applyLighting(emptyLightingState());
    fixture.midi.emit(NATIVE_MODE_REPLY);
    const writesAfterReady = fixture.midi.state.sent.length;

    fixture.midi.emit(NATIVE_MODE_REPLY);
    expect(fixture.midi.state.sent).toHaveLength(writesAfterReady);
    await fixture.surface.stop();
  });

  test("writes complete pad lighting through the public surface", async () => {
    const fixture = await startAtom();
    fixture.midi.emit(NATIVE_MODE_REPLY);
    fixture.midi.state.sent.length = 0;
    const lighting = emptyLightingState();
    lighting.threads[0] = thread(0, 0xffffff, 1, 4);
    lighting.threads[1] = thread(1, 0x304ffe, 1, 1);
    await fixture.surface.applyLighting(lighting);

    for (const note of [36, 48, 51]) {
      expect(padMessages(fixture.midi.state.sent, note)).toEqual([
        [0x90, note, 0], [0x91, note, 0], [0x92, note, 0], [0x93, note, 0],
      ]);
    }
    expect(padMessages(fixture.midi.state.sent, 37)).toEqual([
      [0x90, 37, 127], [0x91, 37, 127], [0x92, 37, 127], [0x93, 37, 127],
    ]);
    expect(padMessages(fixture.midi.state.sent, 39)).toEqual([
      [0x90, 39, 127], [0x91, 39, 25], [0x92, 39, 25], [0x93, 39, 127],
    ]);
    expect(padMessages(fixture.midi.state.sent, 40)).toEqual([
      [0x90, 40, 127], [0x91, 40, 127], [0x92, 40, 127], [0x93, 40, 0],
    ]);
    expect(padMessages(fixture.midi.state.sent, 41)).toEqual([
      [0x90, 41, 127], [0x91, 41, 0], [0x92, 41, 127], [0x93, 41, 0],
    ]);
    expect(padMessages(fixture.midi.state.sent, 42)).toEqual([
      [0x90, 42, 127], [0x91, 42, 127], [0x92, 42, 0], [0x93, 42, 0],
    ]);
    expect(padMessages(fixture.midi.state.sent, 43)).toEqual([
      [0x90, 43, 127], [0x91, 43, 50], [0x92, 43, 0], [0x93, 43, 50],
    ]);
    expect(padMessages(fixture.midi.state.sent, 49)).toEqual([
      [0x90, 49, 2], [0x91, 49, 127], [0x92, 49, 127], [0x93, 49, 127],
    ]);
    expect(padMessages(fixture.midi.state.sent, 50)).toEqual([
      [0x90, 50, 127], [0x91, 50, 7], [0x92, 50, 12], [0x93, 50, 38],
    ]);
    expect(fixture.midi.state.sent).toHaveLength(16 * 4);
    await fixture.surface.stop();
  });

  test("dims every mapped pad instead of turning lighting off after inactivity", async () => {
    const fixture = await startAtom();
    fixture.midi.emit(NATIVE_MODE_REPLY);
    fixture.midi.state.sent.length = 0;
    const sleeping = emptyLightingState();
    sleeping.threads[0]!.color = 0x304ffe;
    await fixture.surface.applyLighting(sleeping);

    for (const note of [36, 48, 51]) {
      expect(padMessages(fixture.midi.state.sent, note)).toEqual([
        [0x90, note, 0], [0x91, note, 0], [0x92, note, 0], [0x93, note, 0],
      ]);
    }
    for (const note of [37, 38, 44, 45, 46, 47, 50]) {
      expect(padMessages(fixture.midi.state.sent, note)).toEqual([
        [0x90, note, 127], [0x91, note, 25], [0x92, note, 25], [0x93, note, 25],
      ]);
    }
    expect(padMessages(fixture.midi.state.sent, 49)).toEqual([
      [0x90, 49, 127], [0x91, 49, 5], [0x92, 49, 8], [0x93, 49, 25],
    ]);
    expect(padMessages(fixture.midi.state.sent, 39)).toEqual([
      [0x90, 39, 127], [0x91, 39, 5], [0x92, 39, 5], [0x93, 39, 25],
    ]);
    expect(padMessages(fixture.midi.state.sent, 40)).toEqual([
      [0x90, 40, 127], [0x91, 40, 25], [0x92, 40, 25], [0x93, 40, 0],
    ]);
    expect(padMessages(fixture.midi.state.sent, 41)).toEqual([
      [0x90, 41, 127], [0x91, 41, 0], [0x92, 41, 25], [0x93, 41, 0],
    ]);
    expect(padMessages(fixture.midi.state.sent, 42)).toEqual([
      [0x90, 42, 127], [0x91, 42, 25], [0x92, 42, 0], [0x93, 42, 0],
    ]);
    expect(padMessages(fixture.midi.state.sent, 43)).toEqual([
      [0x90, 43, 127], [0x91, 43, 10], [0x92, 43, 0], [0x93, 43, 10],
    ]);
    await fixture.surface.stop();
  });

  test("renders representative task states with selected-task contrast", async () => {
    const fixture = await startAtom();
    fixture.midi.emit(NATIVE_MODE_REPLY);
    fixture.midi.state.sent.length = 0;
    const lighting = emptyLightingState();
    lighting.threads[0] = thread(0, 0xffffff, 1, 1);
    lighting.threads[1] = thread(1, 0x0000ff, 1, 4);
    lighting.threads[2] = thread(2, 0x00ff80, 1, 1);
    lighting.threads[3] = thread(3, 0xffcc00, 1, 1);
    lighting.threads[4] = thread(4, 0xff0000, 1, 1);
    await fixture.surface.applyLighting(lighting);

    expect(padMessages(fixture.midi.state.sent, 49)).toEqual([
      [0x90, 49, 127], [0x91, 49, 38], [0x92, 49, 38], [0x93, 49, 38],
    ]);
    expect(padMessages(fixture.midi.state.sent, 50)).toEqual([
      [0x90, 50, 2], [0x91, 50, 0], [0x92, 50, 0], [0x93, 50, 127],
    ]);
    expect(padMessages(fixture.midi.state.sent, 44)).toEqual([
      [0x90, 44, 127], [0x91, 44, 0], [0x92, 44, 38], [0x93, 44, 0],
    ]);
    expect(padMessages(fixture.midi.state.sent, 45)).toEqual([
      [0x90, 45, 127], [0x91, 45, 38], [0x92, 45, 30], [0x93, 45, 0],
    ]);
    expect(padMessages(fixture.midi.state.sent, 46)).toEqual([
      [0x90, 46, 127], [0x91, 46, 38], [0x92, 46, 0], [0x93, 46, 0],
    ]);
    expect(padMessages(fixture.midi.state.sent, 47)).toEqual([
      [0x90, 47, 0], [0x91, 47, 0], [0x92, 47, 0], [0x93, 47, 0],
    ]);
    await fixture.surface.stop();
  });

  test("renegotiates and replays lighting after reconnect", async () => {
    jest.useFakeTimers();
    const fixture = await startAtom();
    fixture.midi.emit(NATIVE_MODE_REPLY);
    const lighting = emptyLightingState();
    lighting.threads[0] = thread(0, 0xffffff, 1, 4);
    await fixture.surface.applyLighting(lighting);
    const firstWrites = countMessage(fixture.midi.state.sent, [0x91, 49, 127]);

    fixture.midi.dropConnection();
    await advanceTime(1_000);
    await advanceTime(1_000);
    expect(fixture.midi.state.outputOpens).toBe(2);
    expect(fixture.midi.state.sent.slice(-2)).toEqual([NATIVE_MODE_OFF, NATIVE_MODE_ON]);
    fixture.midi.emit(NATIVE_MODE_REPLY);
    expect(countMessage(fixture.midi.state.sent, [0x91, 49, 127])).toBe(firstWrites + 1);
    await fixture.surface.stop();
  });
});

async function startAtom() {
  const midi = createMidiTestBackend({ inputs: ["ATOM"], outputs: ["ATOM"] });
  const keys: CodexKeyEvent[] = [];
  const joystick: CodexJoystickEvent[] = [];
  const controller = createController(
    { type: "atom" },
    { midi: midi.backend, logger: quietLogger },
  );
  await controller.surface.start({
    emitKey: async (event) => { keys.push(event); },
    emitJoystick: async (event) => { joystick.push(event); },
  });
  return {
    midi,
    keys,
    joystick,
    surface: controller.surface,
    displayName: controller.displayName,
  };
}

function thread(id: number, color: number, brightness: number, effect: number) {
  return {
    id,
    color,
    brightness,
    effect,
    speed: 0,
    syncKeysLighting: false,
    syncAmbientLighting: false,
  };
}

function padMessages(messages: number[][], note: number): number[][] {
  return messages.filter((message) => message[1] === note);
}

function countMessage(messages: number[][], expected: number[]): number {
  return messages.filter(
    (message) => message.length === expected.length
      && message.every((byte, index) => byte === expected[index]),
  ).length;
}

async function advanceTime(milliseconds: number): Promise<void> {
  jest.advanceTimersByTime(milliseconds);
  await flushPromises();
}

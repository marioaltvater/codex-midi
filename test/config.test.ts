import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "bun:test";
import { loadConfig } from "../src/config.js";

const temporaryDirectories: string[] = [];
const exampleConfig = fileURLToPath(new URL("../codex-midi.example.json", import.meta.url));

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("loadConfig accepts only bridge location and controller port selection", async () => {
  const path = await writeConfig({
    socketPath: "/tmp/codex-midi-test.sock",
    controller: {
      type: "atom",
      inputName: "ATOM Input",
      outputName: "ATOM Output",
    },
  });

  assert.deepEqual(await loadConfig(path), {
    socketPath: "/tmp/codex-midi-test.sock",
    controller: {
      type: "atom",
      inputName: "ATOM Input",
      outputName: "ATOM Output",
    },
  });
});

test("the tracked example configuration is valid JSON5", async () => {
  assert.deepEqual(await loadConfig(exampleConfig), {
    controller: { type: "atom" },
  });
});

test("loadConfig accepts JSON5 comments and trailing commas", async () => {
  const path = await writeConfigSource(`{
    // Exact MIDI port overrides are optional.
    controller: {
      type: "atom",
      inputName: "ATOM Input",
    },
  }`);

  assert.deepEqual(await loadConfig(path), {
    controller: {
      type: "atom",
      inputName: "ATOM Input",
    },
  });
});

test("loadConfig rejects options outside the public v1 configuration", async () => {
  const path = await writeConfig({
    controller: { type: "atom", mapping: { pads: { 49: "AG05" } } },
  });

  await assert.rejects(loadConfig(path), {
    name: "TypeError",
    message: "Unknown controller option: mapping",
  });
});

test("loadConfig rejects the legacy string controller form", async () => {
  const path = await writeConfig({ controller: "atom" });

  await assert.rejects(loadConfig(path), {
    name: "TypeError",
    message: 'controller must be an object such as { "type": "atom" }',
  });
});

async function writeConfig(value: unknown): Promise<string> {
  return writeConfigSource(`${JSON.stringify(value)}\n`);
}

async function writeConfigSource(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codex-midi-config-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "config.json");
  await writeFile(path, source, "utf8");
  return path;
}

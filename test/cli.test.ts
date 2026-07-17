import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const launcher = fileURLToPath(new URL("../bin/codex-midi-chatgpt", import.meta.url));

test("help paths never initialize the native MIDI addon", () => {
  for (const args of [
    ["midi", "monitor", "--help"],
    ["midi", "list", "--help"],
    ["controllers", "--help"],
  ]) {
    const result = runCli(args);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).toBe("");
  }
});

test("top-level help exposes only the public v1 commands", () => {
  const result = runCli(["--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("codex-midi bridge");
  expect(result.stdout).toContain("codex-midi launch");
  expect(result.stdout).toContain("codex-midi midi list");
  expect(result.stdout).toContain("codex-midi midi monitor");
  expect(result.stdout).toContain("codex-midi controllers");
  expect(result.stderr).toBe("");
});

test("checkout launcher resolves the project from any working directory", () => {
  const result = Bun.spawnSync([launcher, "--help"], {
    cwd: tmpdir(),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Usage: codex-midi launch");
  expect(result.stderr.toString()).toBe("");
});

test("midi monitor rejects unknown options before touching hardware", () => {
  const result = runCli(["midi", "monitor", "--unknown"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Unknown midi monitor option: --unknown");
  expect(result.stderr).not.toContain("MidiInCore");
});

function runCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync([process.execPath, cli, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

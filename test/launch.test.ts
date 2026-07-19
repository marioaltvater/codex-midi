import { expect, test } from "bun:test";
import { defaultChatGPTExecutable } from "../src/host/launch.js";

test("selects the platform desktop executable", () => {
  expect(defaultChatGPTExecutable("darwin")).toBe(
    "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
  );
  expect(defaultChatGPTExecutable("linux")).toBe("/usr/bin/codex-desktop");
  expect(() => defaultChatGPTExecutable("win32")).toThrow("Unsupported platform: win32");
});

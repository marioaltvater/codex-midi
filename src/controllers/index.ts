import type { ControllerConfig } from "../config.js";
import atom from "./atom/index.js";
import type {
  ControllerContext,
  MidiControllerProfile,
} from "./controller-profile.js";
import { createMidiSurface } from "./midi-surface.js";

const profiles = { atom } satisfies Record<string, MidiControllerProfile>;

export function createController(
  config: Readonly<ControllerConfig>,
  context: ControllerContext,
) {
  const profile = profiles[config.type as keyof typeof profiles];
  if (profile === undefined) {
    throw new TypeError(
      `Unknown controller type "${config.type}". Available types: ${listControllerIds().join(", ")}`,
    );
  }
  return {
    displayName: profile.displayName,
    surface: createMidiSurface(profile, config, context),
  };
}

export function listControllerIds(): string[] {
  return Object.keys(profiles).sort();
}

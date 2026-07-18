import type { ControllerConfig } from "../config.js";
import atom from "./atom/index.js";
import type { ControllerContext, ControllerDefinition } from "./controller.js";
import { createMidiSurface } from "./midi-surface.js";

const controllers = {
  atom: {
    displayName: atom.displayName,
    create(config, context) {
      return createMidiSurface(atom, config, context);
    },
  },
} satisfies Record<string, ControllerDefinition>;

export function createController(
  config: Readonly<ControllerConfig>,
  context: ControllerContext,
) {
  const definition = controllers[config.type as keyof typeof controllers];
  if (definition === undefined) {
    throw new TypeError(
      `Unknown controller type "${config.type}". Available types: ${listControllerIds().join(", ")}`,
    );
  }
  return {
    displayName: definition.displayName,
    surface: definition.create(config, context),
  };
}

export function listControllerIds(): string[] {
  return Object.keys(controllers).sort();
}

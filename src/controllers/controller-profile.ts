/**
 * The controller contract shared by MIDI profiles and the generic controller
 * surface. Hardware protocol details belong in each controller's profile.
 */

import type {
  CodexButtonKey,
  CodexLightingState,
} from "../core/codex-micro.js";
import type { MidiBackend, MidiMessage } from "../midi/index.js";

export type ControllerLogger = Pick<Console, "debug" | "info" | "warn" | "error">;
export type JoystickDirection = "up" | "down" | "left" | "right";

export interface ControllerContext {
  readonly logger: ControllerLogger;
  readonly midi?: MidiBackend;
}

export interface MidiMapping {
  readonly notes?: Readonly<Record<number, CodexButtonKey | null>>;
  readonly buttons?: Readonly<Record<number, CodexButtonKey | null>>;
  readonly joystick?: Readonly<Record<number, JoystickDirection | null>>;
}

export interface RelativeEncoder {
  readonly cc: number;
  readonly clockwise: readonly number[];
  readonly counterClockwise: readonly number[];
  readonly pulsesPerStep: number;
  readonly minStepIntervalMs: number;
  readonly pulseSequenceTimeoutMs: number;
}

export interface LightingFrame {
  readonly id: string;
  readonly messages: readonly MidiMessage[];
}

export type DisconnectReason = "stopped" | "lost" | "error";

export interface ControllerConnection {
  readonly logger: ControllerLogger;
  send(message: MidiMessage): void;
  ready(): void;
  reconnect(): void;
}

export interface ControllerSession {
  connect(connection: ControllerConnection): void;
  handleMessage?(message: MidiMessage): boolean;
  disconnect?(reason: DisconnectReason, connection: ControllerConnection): void;
}

export interface MidiControllerProfile {
  readonly displayName: string;
  readonly ports: {
    readonly input: string;
    readonly output?: string;
  };
  readonly inputChannel?: number;
  readonly mapping: MidiMapping;
  readonly encoder?: RelativeEncoder;
  createSession?(): ControllerSession;
  renderLighting?(state: Readonly<CodexLightingState>): readonly LightingFrame[];
}

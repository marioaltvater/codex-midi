/** The declarative contract between MIDI hardware profiles and the shared surface. */

import type {
  CodexButtonKey,
  CodexLightingState,
} from "../core/codex-micro.js";
import type { MidiMessage } from "../midi/index.js";
import type {
  CodexAppAction,
  ControllerLogger,
} from "./controller.js";

export type JoystickDirection = "up" | "down" | "left" | "right";

export interface MidiActionBinding {
  readonly press: CodexAppAction;
  readonly shifted?: CodexAppAction;
}

export interface MidiMapping {
  readonly notes?: Readonly<Record<number, CodexButtonKey | null>>;
  readonly buttons?: Readonly<Record<number, CodexButtonKey | null>>;
  readonly joystick?: Readonly<Record<number, JoystickDirection | null>>;
  readonly shift?: {
    readonly notes?: readonly number[];
    readonly buttons?: readonly number[];
  };
  readonly actions?: {
    readonly notes?: Readonly<Record<number, MidiActionBinding | null>>;
    readonly buttons?: Readonly<Record<number, MidiActionBinding | null>>;
  };
}

export type EncoderTarget =
  | {
      readonly type: "micro-key";
      readonly key: "ENC_CW" | "ENC_CC";
    }
  | {
      readonly type: "app-action";
      readonly action: CodexAppAction;
    };

export interface RelativeEncoder {
  readonly cc: number;
  readonly clockwise: readonly number[];
  readonly counterClockwise: readonly number[];
  readonly targets: {
    readonly clockwise: EncoderTarget;
    readonly counterClockwise: EncoderTarget;
  };
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
  dispatchAction(action: CodexAppAction): void;
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
  readonly encoders?: readonly RelativeEncoder[];
  createSession?(): ControllerSession;
  renderLighting?(state: Readonly<CodexLightingState>): readonly LightingFrame[];
}

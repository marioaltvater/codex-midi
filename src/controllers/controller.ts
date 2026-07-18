/** Controller-neutral inputs, feedback, and semantic ChatGPT actions. */

import type { ControllerConfig } from "../config.js";
import type { ControllerSurface } from "../core/codex-micro.js";

export type ControllerLogger = Pick<Console, "debug" | "info" | "warn" | "error">;

export type CodexAppAction =
  | "toggle-left-sidebar"
  | "toggle-review-panel"
  | "toggle-maximize-review-panel"
  | "previous-task"
  | "next-task"
  | "scroll-task-up"
  | "scroll-task-down"
  | "scroll-task-to-bottom"
  | "toggle-plan-mode"
  | "run-environment-action"
  | "open-codex-micro-settings";

export interface AppActionDispatcher {
  dispatch(action: CodexAppAction): Promise<void>;
}

export interface ControllerContext {
  readonly logger: ControllerLogger;
  readonly appActions: AppActionDispatcher;
}

export interface ControllerDefinition {
  readonly displayName: string;
  create(
    config: Readonly<ControllerConfig>,
    context: ControllerContext,
  ): ControllerSurface;
}

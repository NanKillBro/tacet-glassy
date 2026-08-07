// -- Spike 2 message protocol -----------------------------------------------
//
// Shared by contents/spike2.ts (isolated world), background.ts (service
// worker), and workers/offscreen.ts (offscreen document). Step messages carry
// the same shape whether they cross window.postMessage (Path A) or
// chrome.runtime messaging (Path B).

export type Spike2Path = "A" | "B";

export interface StartPathBMessage {
  type: "blk-spike2-start-pathb";
}

export interface RunPathBCommand {
  type: "blk-spike2-run-pathb";
}

export interface StepMessage {
  type: "blk-spike2-step";
  path: Spike2Path;
  step: string;
  ok: boolean;
  error?: string;
}

export interface LogMessage {
  type: "blk-spike2-log";
  path: Spike2Path;
  line: string;
}

export function isStartPathBMessage(data: unknown): data is StartPathBMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-spike2-start-pathb";
}

export function isRunPathBCommand(data: unknown): data is RunPathBCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-spike2-run-pathb";
}

export function isStepMessage(data: unknown): data is StepMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-spike2-step" &&
    typeof (data as { step?: unknown }).step === "string" &&
    typeof (data as { ok?: unknown }).ok === "boolean"
  );
}

export function isLogMessage(data: unknown): data is LogMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-spike2-log" &&
    typeof (data as { line?: unknown }).line === "string"
  );
}

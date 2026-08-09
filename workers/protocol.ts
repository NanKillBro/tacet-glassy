import type { SeparationError } from "@/separation/types";

// -- Isolated world to worker message protocol ------------------------------

export interface LoadCommand {
  type: "load";
  ortBaseUrl: string;
}

export interface WorkerResultMessage {
  type: "result";
  ortLoaded: boolean;
  webgpuSession: boolean;
  hasNavigatorGpu: boolean;
  ortError: string | null;
  webgpuError: string | null;
}

export function isLoadCommand(data: unknown): data is LoadCommand {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "load" &&
    typeof (data as { ortBaseUrl?: unknown }).ortBaseUrl === "string"
  );
}

export function isWorkerResultMessage(data: unknown): data is WorkerResultMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "result";
}

// -- Separation host to worker message protocol ------------------------------

export interface SeparateInitCommand {
  type: "separate-init";
  ortBaseUrl: string;
  modelBytes: ArrayBuffer;
  forceWasm?: boolean;
}

export interface SeparateProcessCommand {
  type: "separate-process";
  channels: Float32Array[];
  totalFrames: number;
}

export interface SeparateCancelCommand {
  type: "separate-cancel";
}

export interface SeparateInitDoneMessage {
  type: "separate-init-done";
}

export interface SeparateProgressMessage {
  type: "separate-progress";
  processed: number;
  total: number;
}

export interface SeparateRegionMessage {
  type: "separate-region";
  vocals: Float32Array[];
  instrumental: Float32Array[];
  regionStart: number;
  totalFrames: number;
}

export interface SeparateDoneMessage {
  type: "separate-done";
  totalFrames: number;
}

export interface SeparateCancelledMessage {
  type: "separate-cancelled";
}

export interface SeparateErrorMessage {
  type: "separate-error";
  code: SeparationError["code"];
  message: string;
}

export function isSeparateInitCommand(data: unknown): data is SeparateInitCommand {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "separate-init" &&
    typeof (data as { ortBaseUrl?: unknown }).ortBaseUrl === "string" &&
    (data as { modelBytes?: unknown }).modelBytes instanceof ArrayBuffer
  );
}

export function isSeparateProcessCommand(data: unknown): data is SeparateProcessCommand {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "separate-process" &&
    Array.isArray((data as { channels?: unknown }).channels) &&
    typeof (data as { totalFrames?: unknown }).totalFrames === "number"
  );
}

export function isSeparateCancelCommand(data: unknown): data is SeparateCancelCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "separate-cancel";
}

export function isSeparateInitDoneMessage(data: unknown): data is SeparateInitDoneMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "separate-init-done";
}

export function isSeparateProgressMessage(data: unknown): data is SeparateProgressMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "separate-progress" &&
    typeof (data as { processed?: unknown }).processed === "number" &&
    typeof (data as { total?: unknown }).total === "number"
  );
}

export function isSeparateRegionMessage(data: unknown): data is SeparateRegionMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "separate-region" &&
    Array.isArray((data as { vocals?: unknown }).vocals) &&
    Array.isArray((data as { instrumental?: unknown }).instrumental) &&
    typeof (data as { regionStart?: unknown }).regionStart === "number"
  );
}

export function isSeparateDoneMessage(data: unknown): data is SeparateDoneMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "separate-done" &&
    typeof (data as { totalFrames?: unknown }).totalFrames === "number"
  );
}

export function isSeparateCancelledMessage(data: unknown): data is SeparateCancelledMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "separate-cancelled";
}

export function isSeparateErrorMessage(data: unknown): data is SeparateErrorMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "separate-error" &&
    typeof (data as { code?: unknown }).code === "string" &&
    typeof (data as { message?: unknown }).message === "string"
  );
}

export type SeparateInboundCommand = SeparateInitCommand | SeparateProcessCommand | SeparateCancelCommand;

export type SeparateOutboundMessage =
  | SeparateInitDoneMessage
  | SeparateProgressMessage
  | SeparateRegionMessage
  | SeparateDoneMessage
  | SeparateCancelledMessage
  | SeparateErrorMessage;

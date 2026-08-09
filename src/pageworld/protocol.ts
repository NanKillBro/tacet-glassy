// -- Isolated to page world audio bridge protocol -----------------------------

export interface SetMixLevelMessage {
  type: "blk-set-mix-level";
  mixLevel: number;
}

export interface LoadStemsMessage {
  type: "blk-load-stems";
  videoId: string;
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

export interface StopStemsMessage {
  type: "blk-stop-stems";
}

export type AudioBridgeMessage = SetMixLevelMessage | LoadStemsMessage | StopStemsMessage;

function isFloat32ArrayList(value: unknown): value is Float32Array<ArrayBuffer>[] {
  return Array.isArray(value) && value.every(channel => channel instanceof Float32Array);
}

export function isSetMixLevelMessage(data: unknown): data is SetMixLevelMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-set-mix-level" &&
    typeof (data as { mixLevel?: unknown }).mixLevel === "number"
  );
}

export function isLoadStemsMessage(data: unknown): data is LoadStemsMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-load-stems" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    isFloat32ArrayList((data as { vocals?: unknown }).vocals) &&
    isFloat32ArrayList((data as { instrumental?: unknown }).instrumental) &&
    typeof (data as { sampleRate?: unknown }).sampleRate === "number"
  );
}

export function isStopStemsMessage(data: unknown): data is StopStemsMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-stop-stems";
}

export function isAudioBridgeMessage(data: unknown): data is AudioBridgeMessage {
  return isSetMixLevelMessage(data) || isLoadStemsMessage(data) || isStopStemsMessage(data);
}

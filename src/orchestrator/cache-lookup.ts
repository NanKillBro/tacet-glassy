// Decides how far a track gets through the cache before separation is
// needed, per the design doc's videoId-alias-to-content-key scheme (see
// src/cache/keys.ts and src/cache/stem-store.ts). Pure: the offscreen
// pipeline resolves the actual records from IndexedDB and hands their
// frame counts here, checking the alias first and only reading the content
// key once the alias misses, so this function's alias-hit branch models
// the fast path even though the real caller short-circuits before it would
// need the content record at all.

type CacheLookupOutcome = "alias-hit" | "content-hit" | "miss";

interface FrameCounts {
  framesDone: number;
  totalFrames: number;
}

function isRecordComplete(record: FrameCounts): boolean {
  return record.framesDone === record.totalFrames;
}

function decideCacheLookup(aliasRecord: FrameCounts | null, contentRecord: FrameCounts | null): CacheLookupOutcome {
  if (aliasRecord && isRecordComplete(aliasRecord)) return "alias-hit";
  if (contentRecord && isRecordComplete(contentRecord)) return "content-hit";
  return "miss";
}

export { isRecordComplete, decideCacheLookup };
export type { CacheLookupOutcome, FrameCounts };

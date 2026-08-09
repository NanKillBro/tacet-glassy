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

const MAX_RETAINED_CAPTURES = 2;

function videoIdsToRelease(retainedInOrder: readonly string[], keep: number = MAX_RETAINED_CAPTURES): string[] {
  const excess = retainedInOrder.length - Math.max(0, keep);
  return excess > 0 ? retainedInOrder.slice(0, excess) : [];
}

export { MAX_RETAINED_CAPTURES, videoIdsToRelease };

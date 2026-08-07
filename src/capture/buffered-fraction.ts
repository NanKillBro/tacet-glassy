function computeBufferedFraction(bufferedEndSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return Number.NaN;
  return Math.min(1, Math.max(0, bufferedEndSeconds / durationSeconds));
}

export { computeBufferedFraction };

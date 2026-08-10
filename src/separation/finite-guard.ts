// -- Non-finite output guard ----------------------------------------------------

interface FiniteReport {
  finite: boolean;
  nonFiniteCount: number;
  firstIndex: number;
  total: number;
}

function inspectFinite(channels: readonly Float32Array[]): FiniteReport {
  let nonFiniteCount = 0;
  let firstIndex = -1;
  let total = 0;

  for (let c = 0; c < channels.length; c++) {
    const channel = channels[c];
    total += channel.length;
    for (let i = 0; i < channel.length; i++) {
      if (Number.isFinite(channel[i])) continue;
      nonFiniteCount++;
      if (firstIndex === -1) firstIndex = i;
    }
  }

  return { finite: nonFiniteCount === 0, nonFiniteCount, firstIndex, total };
}

function describeNonFinite(report: FiniteReport, chunkIndex: number): string {
  const percent = report.total === 0 ? 0 : (report.nonFiniteCount / report.total) * 100;
  return (
    `chunk ${chunkIndex} produced ${report.nonFiniteCount} non-finite samples ` +
    `of ${report.total} (${percent.toFixed(1)}%), first at index ${report.firstIndex}`
  );
}

export { describeNonFinite, inspectFinite };
export type { FiniteReport };

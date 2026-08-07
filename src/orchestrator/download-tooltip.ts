const DOWNLOAD_TOOLTIP_REASON = "This is paced by YouTube's own buffering, so it can be slow.";

function formatDownloadTooltip(bufferedFraction: number): string {
  if (!Number.isFinite(bufferedFraction)) return `Downloading the track… ${DOWNLOAD_TOOLTIP_REASON}`;
  const percent = Math.round(Math.min(1, Math.max(0, bufferedFraction)) * 100);
  return `Downloading the track… ${percent}%. ${DOWNLOAD_TOOLTIP_REASON}`;
}

export { formatDownloadTooltip };

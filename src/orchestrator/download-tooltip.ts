// Two acquisition paths reach this tooltip, paced by different things: the
// hidden player runs whatever the listener does, the fallback only finishes if
// they sit through the track.

type DownloadSource = "hidden-player" | "listener-playback";

const HIDDEN_PLAYER_REASON = "Downloading in the background. This runs on its own, so you can keep listening.";
const LISTENER_PLAYBACK_REASON = "This is paced by YouTube's own buffering, so it can be slow.";

function reasonFor(source: DownloadSource): string {
  return source === "hidden-player" ? HIDDEN_PLAYER_REASON : LISTENER_PLAYBACK_REASON;
}

function formatDownloadTooltip(bufferedFraction: number, source: DownloadSource = "listener-playback"): string {
  const reason = reasonFor(source);
  if (!Number.isFinite(bufferedFraction)) return `Downloading the track… ${reason}`;
  const percent = Math.round(Math.min(1, Math.max(0, bufferedFraction)) * 100);
  return `Downloading the track… ${percent}%. ${reason}`;
}

export { formatDownloadTooltip, HIDDEN_PLAYER_REASON, LISTENER_PLAYBACK_REASON };
export type { DownloadSource };

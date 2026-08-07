// Two acquisition paths reach this tooltip and they are paced by different
// things, so they must not claim the same thing. The hidden player runs
// whatever the listener does, at about the length of the song; the fallback
// rides the listener's own playback and only finishes if they sit through it.

type DownloadSource = "hidden-player" | "listener-playback";

const HIDDEN_PLAYER_REASON = "Downloading in the background. YouTube paces this, so it takes about the song's length.";
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

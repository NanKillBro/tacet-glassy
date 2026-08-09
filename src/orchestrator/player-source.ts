interface PlayerState {
  videoId: string;
  durationSeconds: number;
}

const BETTER_LYRICS_PLAYER_EVENT = "blyrics-send-player-time";

function readState(videoId: unknown, duration: unknown): PlayerState | null {
  if (typeof videoId !== "string" || videoId.length === 0) return null;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return null;
  return { videoId, durationSeconds: duration };
}

// Better Lyrics names these song/artist/duration; only the identity matters here.
function playerStateFromBetterLyrics(detail: unknown): PlayerState | null {
  if (typeof detail !== "object" || detail === null) return null;
  const record = detail as { videoId?: unknown; duration?: unknown };
  return readState(record.videoId, record.duration);
}

function playerStateFromOwnBridge(message: unknown): PlayerState | null {
  if (typeof message !== "object" || message === null) return null;
  const record = message as { type?: unknown; videoId?: unknown; durationSeconds?: unknown };
  if (record.type !== "blk-player-state") return null;
  return readState(record.videoId, record.durationSeconds);
}

export { BETTER_LYRICS_PLAYER_EVENT, playerStateFromBetterLyrics, playerStateFromOwnBridge };
export type { PlayerState };

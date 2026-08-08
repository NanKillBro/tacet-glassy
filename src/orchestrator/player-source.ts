// One shape for "what track is playing", from whichever bridge is publishing.
//
// Better Lyrics already runs a page-world bridge on this exact player and
// dispatches blyrics-send-player-time on the document, which an isolated
// content script receives directly. When it is installed we read that rather
// than running a second bridge over the same object; when it is not, our own
// page world publishes blk-player-state in its place.
//
// Both are gated the same way, on the rule Better Lyrics established: a player
// that will not name a video or report a positive duration is not playing a
// track, which is what an ad and a still-loading player both look like.

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

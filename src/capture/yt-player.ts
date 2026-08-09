import { MOVIE_PLAYER_ELEMENT_ID } from "@/capture/ad-guard";
import { createLogger } from "@/shared/logger";

const logger = createLogger("capture");

interface PlayerVideoData {
  video_id?: unknown;
  isAd?: unknown;
}

interface YtPlayer {
  getVideoData?: () => PlayerVideoData;
  getDuration?: () => number;
  playVideo?: () => void;
  pauseVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate?: (rate: number) => void;
  getPlayerState?: () => number;
  setAutonav?: (enabled: boolean) => void;
  setAutonavState?: (state: number) => void;
  setLoopVideo?: (enabled: boolean) => void;
  clearQueue?: () => void;
}

// YT.PlayerState.PLAYING
const PLAYER_STATE_PLAYING = 1;

function getYtPlayer(doc: Document): YtPlayer | null {
  const element = doc.getElementById(MOVIE_PLAYER_ELEMENT_ID);
  return element ? (element as unknown as YtPlayer) : null;
}

function callSafely(label: string, fn: (() => void) | undefined): boolean {
  if (typeof fn !== "function") return false;
  try {
    fn();
    return true;
  } catch (error) {
    logger.warn(`player.${label} failed`, error);
    return false;
  }
}

function suppressAutoAdvance(player: YtPlayer): void {
  callSafely("setAutonav", player.setAutonav && (() => player.setAutonav?.(false)));
  callSafely("setAutonavState", player.setAutonavState && (() => player.setAutonavState?.(0)));
  callSafely("setLoopVideo", player.setLoopVideo && (() => player.setLoopVideo?.(true)));
  callSafely("clearQueue", player.clearQueue && (() => player.clearQueue?.()));
}

function readVideoData(player: YtPlayer | null): PlayerVideoData | null {
  if (!player || typeof player.getVideoData !== "function") return null;
  try {
    return player.getVideoData() ?? null;
  } catch {
    return null;
  }
}

function isPlaying(player: YtPlayer): boolean {
  if (typeof player.getPlayerState !== "function") return false;
  try {
    return player.getPlayerState() === PLAYER_STATE_PLAYING;
  } catch {
    return false;
  }
}

export { getYtPlayer, suppressAutoAdvance, callSafely, isPlaying, readVideoData, PLAYER_STATE_PLAYING };
export type { YtPlayer };

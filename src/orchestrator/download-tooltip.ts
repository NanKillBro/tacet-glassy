import type { TooltipContent } from "@/ui/tooltip";

type DownloadSource = "hidden-player" | "listener-playback";

const HIDDEN_PLAYER_LABEL = "Downloading the track…";
const LISTENER_PLAYBACK_LABEL = "Buffering with the player…";

function describeDownload(bufferedFraction: number, source: DownloadSource = "listener-playback"): TooltipContent {
  return {
    label: source === "hidden-player" ? HIDDEN_PLAYER_LABEL : LISTENER_PLAYBACK_LABEL,
    percent: Number.isFinite(bufferedFraction) ? Math.min(1, Math.max(0, bufferedFraction)) : null,
  };
}

export { describeDownload, HIDDEN_PLAYER_LABEL, LISTENER_PLAYBACK_LABEL };
export type { DownloadSource };

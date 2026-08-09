import { describeDownload } from "@/orchestrator/download-tooltip";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { ARMED_LABEL } from "@/ui/armed-affordance";
import type { TooltipContent } from "@/ui/tooltip";

// -- Busy tooltip --------------------------------------------------------------

function describeStage(state: KaraokeState): TooltipContent {
  switch (state.stage) {
    case "checking-cache":
      return { label: "Checking for cached vocals…", percent: null };
    case "decoding":
      return { label: "Decoding the captured track…", percent: null };
    case "downloading-model":
      return { label: "Downloading the separation model…", percent: null };
    case "loading-model":
      return { label: "Loading the separation model…", percent: null };
    case "separating":
      return { label: "Separating vocals…", percent: state.total > 0 ? state.processed / state.total : null };
    case "encoding":
      return { label: "Finishing up…", percent: null };
    default:
      return { label: "Preparing sing-along…", percent: null };
  }
}

function describeBusy(state: KaraokeState, armed: boolean): TooltipContent {
  const stage =
    state.status === "waiting-for-capture" && state.downloadSource !== null
      ? describeDownload(state.downloadFraction, state.downloadSource)
      : describeStage(state);
  return { ...stage, note: armed ? ARMED_LABEL : null };
}

export { describeBusy, describeStage };

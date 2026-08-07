import type { PlasmoCSConfig } from "plasmo";
import { createKaraokePipeline } from "@/orchestrator/karaoke-pipeline";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { createFaderControl } from "@/ui/fader";
import { attachFaderMount, hasBetterLyrics } from "@/ui/mount";

// -- Fader UI wiring -----------------------------------------------------------
//
// ISOLATED world: mounts the real fader control (src/ui/fader.ts) next to
// Better Lyrics' dock or the player bar (src/ui/mount.ts), and drives it
// from the karaoke pipeline (src/contents/karaoke-pipeline.ts), which owns
// every message to and from the page world and the offscreen document.
//
// The button is disabled whenever the pipeline cannot act on a click right
// now (capture not confirmed yet, a separation in flight, or a failure),
// each with an honest tooltip. See src/orchestrator/karaoke-state.ts for
// the state machine this renders.

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_end",
  all_frames: false,
};

function markUnavailable(button: HTMLButtonElement, reason: string): void {
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.title = reason;
  button.style.opacity = "0.45";
  button.style.filter = "grayscale(70%)";
  button.style.cursor = "not-allowed";
}

function markAvailable(button: HTMLButtonElement): void {
  button.disabled = false;
  button.removeAttribute("aria-disabled");
  button.title = "";
  button.style.opacity = "";
  button.style.filter = "";
  button.style.cursor = "";
}

function describeStage(state: KaraokeState): string {
  switch (state.stage) {
    case "checking-cache":
      return "Checking for cached vocals…";
    case "decoding":
      return "Decoding the captured track…";
    case "downloading-model":
      return "Downloading the vocal separation model…";
    case "separating": {
      const percent = state.total > 0 ? ` ${Math.round((state.processed / state.total) * 100)}%` : "";
      return `Separating vocals…${percent}`;
    }
    case "encoding":
      return "Finishing up…";
    default:
      return "Preparing sing-along…";
  }
}

function renderKaraokeState(button: HTMLButtonElement, state: KaraokeState): void {
  switch (state.status) {
    case "waiting-for-capture":
      markUnavailable(button, "Sing-along will be ready once this track has finished downloading.");
      break;
    case "ready-to-engage":
    case "engaged":
      markAvailable(button);
      break;
    case "processing":
      markUnavailable(button, describeStage(state));
      break;
    case "failed":
      markUnavailable(button, `Sing-along unavailable: ${state.reason ?? "unknown error"}`);
      break;
  }
}

// createFaderControl emits its initial value during construction, before the
// pipeline below exists, so this cannot assume the pipeline is assigned yet.
let pipeline: ReturnType<typeof createKaraokePipeline> | undefined;

const control = createFaderControl({
  host: hasBetterLyrics() ? "dock" : "bar",
  onChange: mixLevel => pipeline?.engage(mixLevel),
});

pipeline = createKaraokePipeline({
  onStateChange: state => renderKaraokeState(control.button, state),
});

markUnavailable(control.button, "Sing-along will be ready once this track has finished downloading.");

attachFaderMount({ button: control.button, setHost: control.setHost });

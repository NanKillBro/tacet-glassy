import faderCss from "data-text:../ui/fader.css";
import type { PlasmoCSConfig } from "plasmo";
import { formatDownloadTooltip } from "@/orchestrator/download-tooltip";
import { createKaraokePipeline } from "@/orchestrator/karaoke-pipeline";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { createFaderControl } from "@/ui/fader";
import type { FaderControl } from "@/ui/fader";
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

// -- Stylesheet ----------------------------------------------------------
//
// Injected as a same-origin <style> rather than left to Plasmo's manifest
// css array, which was empty and left the control completely unstyled on the
// real page. Same-origin also matters for the @property registration the
// glyph morph depends on: Gecko drops @property from a stylesheet that is
// cross-origin to the document, which a chrome-extension:// link would be.
const STYLE_ELEMENT_ID = "blyrics-karaoke-style";

function injectStylesheet(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = faderCss;
  (document.head ?? document.documentElement).appendChild(style);
}

injectStylesheet();

// dim is for genuine failure only. While working, the shimmer is the
// indication, and greying it out at the same time smothers it.
function markUnavailable(button: HTMLButtonElement, reason: string, dim = false): void {
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.title = reason;
  button.style.opacity = dim ? "0.45" : "";
  button.style.filter = dim ? "grayscale(70%)" : "";
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

function renderKaraokeState(control: FaderControl, state: KaraokeState): void {
  const button = control.button;
  // The shimmer, not a grey-out, is the working state. Grey reads as broken.
  control.setBusy(state.status === "waiting-for-capture" || state.status === "processing");
  switch (state.status) {
    case "waiting-for-capture":
      markUnavailable(button, formatDownloadTooltip(state.downloadFraction));
      break;
    case "ready-to-engage":
    case "engaged":
      markAvailable(button);
      break;
    case "processing":
      markUnavailable(button, describeStage(state));
      break;
    case "failed":
      markUnavailable(button, `Sing-along unavailable: ${state.reason ?? "unknown error"}`, true);
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
  onStateChange: state => renderKaraokeState(control, state),
});

attachFaderMount({ button: control.button, setHost: control.setHost });

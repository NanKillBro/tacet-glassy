import faderCss from "data-text:../ui/fader.css";
import type { PlasmoCSConfig } from "plasmo";
import { describeDownload } from "@/orchestrator/download-tooltip";
import { createKaraokePipeline } from "@/orchestrator/karaoke-pipeline";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { SETTINGS_STORAGE_KEY, sanitizeSettings } from "@/settings/settings";
import { loadSettingsFrom } from "@/settings/storage";
import { createFaderControl } from "@/ui/fader";
import type { FaderControl } from "@/ui/fader";
import { attachFaderMount, hasBetterLyrics } from "@/ui/mount";
import { createTooltip } from "@/ui/tooltip";
import type { Tooltip, TooltipContent } from "@/ui/tooltip";
import { createLogger } from "@/shared/logger";

const logger = createLogger("orchestrator");

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

// aria-disabled rather than the disabled attribute: a disabled button fires no
// pointer events, so the hover card explaining why it is unavailable could never
// appear on the states that most need it. src/ui/fader.ts gates every gesture on
// this attribute instead.
function markUnavailable(button: HTMLButtonElement, dim = false): void {
  button.setAttribute("aria-disabled", "true");
  button.style.opacity = dim ? "0.45" : "";
  button.style.filter = dim ? "grayscale(70%)" : "";
  button.style.cursor = "not-allowed";
}

function markAvailable(button: HTMLButtonElement): void {
  button.removeAttribute("aria-disabled");
  button.style.opacity = "";
  button.style.filter = "";
  button.style.cursor = "";
}

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

function renderKaraokeState(control: FaderControl, tooltip: Tooltip, state: KaraokeState): void {
  const button = control.button;
  // The shimmer, not a grey-out, is the working state. Grey reads as broken.
  control.setBusy(state.status === "waiting-for-capture" || state.status === "processing");
  switch (state.status) {
    case "waiting-for-capture":
      markUnavailable(button);
      tooltip.setContent(
        state.downloadSource === null
          ? describeStage(state)
          : describeDownload(state.downloadFraction, state.downloadSource)
      );
      break;
    case "ready-to-engage":
    case "engaged":
      markAvailable(button);
      tooltip.setContent({ label: "Click to remove vocals, hold to set the level", percent: null });
      break;
    case "processing":
      markUnavailable(button);
      tooltip.setContent(describeStage(state));
      break;
    case "failed":
      markUnavailable(button, true);
      tooltip.setContent({ label: `Sing-along unavailable: ${state.reason ?? "unknown error"}`, percent: null });
      break;
  }
}

// -- Master switch ---------------------------------------------------------
//
// Off means none of this exists: no control, no pipeline, and nothing below
// them (an AudioContext, a claim on the media element). Watched rather than
// read once, so the popup's switch takes effect on the track already playing.

function mountFader(): { destroy(): void } {
  injectStylesheet();

  // createFaderControl emits its initial value during construction, before the
  // pipeline below exists, so this cannot assume the pipeline is assigned yet.
  let pipeline: ReturnType<typeof createKaraokePipeline> | undefined;

  const control = createFaderControl({
    host: hasBetterLyrics() ? "dock" : "bar",
    onChange: mixLevel => pipeline?.engage(mixLevel),
  });

  const tooltip = createTooltip(control.button);

  pipeline = createKaraokePipeline({
    onStateChange: state => renderKaraokeState(control, tooltip, state),
  });

  const mount = attachFaderMount({ button: control.button, setHost: control.setHost });

  return {
    destroy() {
      mount.disconnect();
      // First, since it is what hands the audio back to the original.
      pipeline?.destroy();
      tooltip.destroy();
      control.destroy();
    },
  };
}

let mounted: { destroy(): void } | null = null;

function applySingAlong(enabled: boolean): void {
  if (enabled === (mounted !== null)) return;
  if (enabled) {
    mounted = mountFader();
    logger.log("sing-along on");
    return;
  }
  mounted?.destroy();
  mounted = null;
  logger.log("sing-along off");
}

loadSettingsFrom(chrome.storage.sync)
  .then(settings => applySingAlong(settings.singAlongEnabled))
  .catch(error => {
    logger.error("failed to check the sing-along setting", error);
  });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !(SETTINGS_STORAGE_KEY in changes)) return;
  applySingAlong(sanitizeSettings(changes[SETTINGS_STORAGE_KEY].newValue).singAlongEnabled);
});

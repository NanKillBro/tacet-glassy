import type { PlasmoCSConfig } from "plasmo";
import type { SetMixLevelMessage } from "@/pageworld/protocol";
import { createFaderControl } from "@/ui/fader";
import { attachFaderMount, hasBetterLyrics } from "@/ui/mount";

// -- Fader UI wiring -----------------------------------------------------------
//
// ISOLATED world: mounts the real fader control (src/ui/fader.ts) next to
// Better Lyrics' dock or the player bar (src/ui/mount.ts), and relays every
// mix level it emits to the page-world audio graph
// (src/contents/inject-main-world.ts) over window.postMessage.
//
// There are no separated stems yet, so the control starts and stays in its
// disabled, dimmed state with a tooltip explaining why. A later phase that
// loads stems only has to remove the disabled state; the wiring underneath
// is already live.

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_end",
  all_frames: false,
};

const NO_STEMS_REASON = "Sing-along needs separated vocals, which are not available yet.";

function sendMixLevel(mixLevel: number): void {
  const message: SetMixLevelMessage = { type: "blk-set-mix-level", mixLevel };
  window.postMessage(message, window.location.origin);
}

function markUnavailable(button: HTMLButtonElement, reason: string): void {
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.title = reason;
  button.style.opacity = "0.45";
  button.style.filter = "grayscale(70%)";
  button.style.cursor = "not-allowed";
}

const control = createFaderControl({
  host: hasBetterLyrics() ? "dock" : "bar",
  onChange: sendMixLevel,
});

markUnavailable(control.button, NO_STEMS_REASON);

attachFaderMount({ button: control.button, setHost: control.setHost });

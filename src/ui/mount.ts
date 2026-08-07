// Ported from the "Live migration" section of
// docs/mocks/2026-08-07-singalong-mounts.html (better-lyrics repo), plus the
// selectors verified in docs/plans/2026-08-07-singalong-karaoke.md sections
// 2.6 and 2.7.
//
// This is the integration point for whichever content script ends up
// running on music.youtube.com: call attachFaderMount(control) once a
// FaderControl exists (see fader.ts) and it will keep the control mounted
// in the right place as the page re-renders around it. Nothing here reaches
// into src/contents/, src/background.ts or workers/.

import type { FaderControl } from "@/ui/fader";
import { createMountResolver } from "@/ui/hysteresis";
import type { MountTarget } from "@/ui/hysteresis";

const BETTER_LYRICS_STYLE_LINK_SELECTOR = 'link[id^="blyrics-style-"]';
const DOCK_CONTROLS_SELECTOR = ".blyrics-dock__controls";
const PLAYER_BAR_VOLUME_BUTTON_SELECTOR = "ytmusic-player-bar .right-controls-buttons yt-icon-button.volume";

// Better Lyrics injects <link id="blyrics-style-...​"> in injectHeadTags,
// well before the dock exists, so presence is known immediately. Presence
// and the mount point are two separate questions: the dock only appears
// once lyrics render, and can be turned off in settings.
function hasBetterLyrics(root: ParentNode = document): boolean {
  return root.querySelector(BETTER_LYRICS_STYLE_LINK_SELECTOR) !== null;
}

type FaderMountControl = Pick<FaderControl, "button" | "setHost">;

interface AttachFaderMountOptions {
  observeRoot?: Node;
  leaveDelayVisibleMs?: number;
  leaveDelayAbsentMs?: number;
  requestAnimationFrame?(callback: () => void): number;
}

interface FaderMountHandle {
  disconnect(): void;
}

function attachFaderMount(control: FaderMountControl, options: AttachFaderMountOptions = {}): FaderMountHandle {
  const requestFrame = options.requestAnimationFrame ?? (callback => window.requestAnimationFrame(callback));
  const observeRoot = options.observeRoot ?? document.body;

  function dockControlsElement(): HTMLElement | null {
    return document.querySelector<HTMLElement>(DOCK_CONTROLS_SELECTOR);
  }

  function volumeButtonElement(): HTMLElement | null {
    return document.querySelector<HTMLElement>(PLAYER_BAR_VOLUME_BUTTON_SELECTOR);
  }

  function mountTo(target: MountTarget): void {
    if (target === "dock") {
      const dock = dockControlsElement();
      if (!dock) return;
      dock.appendChild(control.button);
    } else {
      const volumeButton = volumeButtonElement();
      if (!volumeButton) return;
      volumeButton.insertAdjacentElement("afterend", control.button);
    }
    control.setHost(target);
  }

  const resolver = createMountResolver({
    leaveDelayVisibleMs: options.leaveDelayVisibleMs,
    leaveDelayAbsentMs: options.leaveDelayAbsentMs,
    isDockPresent: () => dockControlsElement() !== null,
    isControlMountedToDock: () => control.button.parentElement === dockControlsElement(),
    isControlMountedToBar: () => control.button.parentElement === (volumeButtonElement()?.parentElement ?? null),
    isControlVisible: () => control.button.isConnected,
    mountTo,
  });

  // childList only, and coalesced to one check per animation frame. The
  // lyrics tick runs every 50ms or so; a resolver that ran per mutation
  // would run with it.
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestFrame(() => {
      queued = false;
      resolver.resolve();
    });
  });
  observer.observe(observeRoot, { childList: true, subtree: true });

  resolver.resolve(true);

  return {
    disconnect() {
      observer.disconnect();
      resolver.dispose();
    },
  };
}

export {
  BETTER_LYRICS_STYLE_LINK_SELECTOR,
  DOCK_CONTROLS_SELECTOR,
  PLAYER_BAR_VOLUME_BUTTON_SELECTOR,
  hasBetterLyrics,
  attachFaderMount,
};
export type { FaderMountControl, AttachFaderMountOptions, FaderMountHandle };

// The shared bus, published as window.__blyricsAudio. First writer owns it;
// a sibling extension (better-lyrics-shaders) can attach to the same
// context and source without either side knowing about the other's graph.
//
// Real DOM and Web Audio calls only: the claim decision and element
// selection are pure and live in audio-bus-claim.ts and
// select-media-element.ts. Not unit-testable, no AudioContext in Node.

import { decideAudioBusClaim } from "@/pageworld/audio-bus-claim";

const AUDIO_BUS_VERSION = 1;
const AUDIO_BUS_KEY = "__blyricsAudio";

interface BlyricsAudioBus {
  version: number;
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  element: HTMLMediaElement;
}

function isBlyricsAudioBus(value: unknown): value is BlyricsAudioBus {
  if (typeof value !== "object" || value === null) return false;
  const bus = value as Record<string, unknown>;
  return (
    typeof bus.version === "number" &&
    bus.context instanceof AudioContext &&
    bus.source instanceof MediaElementAudioSourceNode &&
    bus.element instanceof HTMLMediaElement
  );
}

function readWindowBus(): unknown {
  return (window as unknown as Record<string, unknown>)[AUDIO_BUS_KEY];
}

function writeWindowBus(bus: BlyricsAudioBus): void {
  (window as unknown as Record<string, unknown>)[AUDIO_BUS_KEY] = bus;
}

// Chrome leaves resume() PENDING rather than rejecting while autoplay policy
// blocks a context. Awaited bare, that hangs acquireAudioBus, which hangs the
// caller's engagement loop permanently with nothing logged anywhere.
const RESUME_TIMEOUT_MS = 3000;

async function resumeOnGesture(context: AudioContext): Promise<boolean> {
  if (context.state !== "running") {
    try {
      await Promise.race([context.resume(), new Promise(resolve => setTimeout(resolve, RESUME_TIMEOUT_MS))]);
    } catch (error) {
      console.error("[BLK-AUDIO-BUS] context.resume() failed", error);
    }
  }

  if (context.state === "running") return true;
  console.warn(`[BLK-AUDIO-BUS] context stuck in "${context.state}" after ${RESUME_TIMEOUT_MS}ms, not engaging yet`);
  return false;
}

// createMediaElementSource may be called once per element, ever. A second
// attempt throws InvalidStateError and leaves that element permanently
// unroutable, so the listener hears the original for the rest of the page's
// life. Every claim is remembered and never repeated. Staleness is judged by
// isConnected, not by a decode counter that reads zero whenever an element is
// merely quiet, which is what used to trigger that fatal second claim.
const claimedElements = new WeakSet<HTMLMediaElement>();
const sourceByElement = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

// The caller names the element: a second guess here could disagree with it, and
// binding the wrong element is permanent.
async function acquireAudioBus(element: HTMLMediaElement): Promise<BlyricsAudioBus | null> {
  const existing = readWindowBus();
  const claim = decideAudioBusClaim(existing, AUDIO_BUS_VERSION, isBlyricsAudioBus);

  if (claim === "incompatible") return null;

  if (claim === "reuse") {
    const bus = existing as BlyricsAudioBus;
    if (bus.element === element && bus.element.isConnected) {
      return (await resumeOnGesture(bus.context)) ? bus : null;
    }
    console.warn("[BLK-AUDIO-BUS] the bus holds a different element, building one for this one");
  }

  // Already ours from an earlier graph: reuse rather than re-claim.
  const claimedSource = sourceByElement.get(element);
  if (claimedSource) {
    const context = claimedSource.context as AudioContext;
    if (!(await resumeOnGesture(context))) return null;
    const bus: BlyricsAudioBus = { version: AUDIO_BUS_VERSION, context, source: claimedSource, element };
    writeWindowBus(bus);
    return bus;
  }

  if (claimedElements.has(element)) {
    console.error(
      "[BLK-AUDIO-BUS] this element was claimed by something else and can never be routed. Reload the page."
    );
    return null;
  }

  // Closed on the way out, not abandoned: Chrome allows only a handful of
  // AudioContexts per page, and a caller that retries would exhaust them.
  const context = new AudioContext();
  if (!(await resumeOnGesture(context))) {
    await context.close();
    return null;
  }

  // The binding is permanent and unrepeatable. If something already claimed
  // this element (an earlier context of ours, another extension, a debug
  // probe), we cannot route its audio at all, and silently carrying on is
  // what made this look like a working feature that changed nothing.
  let source: MediaElementAudioSourceNode;
  try {
    source = context.createMediaElementSource(element);
  } catch (error) {
    // Permanently unroutable now. Remember it so no later attempt wastes
    // another AudioContext, of which Chrome allows only a handful per page.
    claimedElements.add(element);
    console.error(
      "[BLK-AUDIO-BUS] cannot capture the audible element, its audio will keep playing untouched. Reload the page.",
      error
    );
    await context.close();
    return null;
  }
  claimedElements.add(element);
  sourceByElement.set(element, source);
  source.connect(context.destination);

  const bus: BlyricsAudioBus = { version: AUDIO_BUS_VERSION, context, source, element };
  writeWindowBus(bus);
  return bus;
}

export { AUDIO_BUS_VERSION, AUDIO_BUS_KEY, acquireAudioBus, isBlyricsAudioBus };
export type { BlyricsAudioBus };

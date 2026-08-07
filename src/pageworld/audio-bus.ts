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

async function resumeOnGesture(context: AudioContext): Promise<boolean> {
  if (context.state !== "running") {
    try {
      await context.resume();
    } catch (error) {
      console.error("[BLK-AUDIO-BUS] context.resume() failed", error);
    }
  }
  return context.state === "running";
}

// createMediaElementSource can be called at most once per element, ever, and a
// second attempt throws InvalidStateError and leaves that element permanently
// unroutable: "HTMLMediaElement already connected previously to a different
// MediaElementSourceNode", after which the listener hears the original for the
// rest of the page's life. So every element we have ever claimed is remembered,
// and a claim is never attempted twice.
//
// The old staleness test asked whether the bus's element had decoded any bytes
// yet, which is transiently false for an element that is merely quiet, or that
// has just been re-claimed. That sent us down the rebuild path against an
// element we already owned, which is exactly the fatal second claim.
const claimedElements = new WeakSet<HTMLMediaElement>();
const sourceByElement = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

// The caller names the element. It knows which one the audio belongs to (see
// elementForStems in src/contents/inject-main-world.ts); a second, independent
// guess here could disagree with it, and binding the wrong element is permanent.
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

  // Already ours from an earlier graph: reuse that source rather than making a
  // fatal second claim. This is the path the rebuild used to take blindly.
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

  const context = new AudioContext();
  if (!(await resumeOnGesture(context))) return null;

  // The binding is permanent and unrepeatable. If something already claimed
  // this element (an earlier context of ours, another extension, a debug
  // probe), we cannot route its audio at all, and silently carrying on is
  // what made this look like a working feature that changed nothing.
  let source: MediaElementAudioSourceNode;
  try {
    source = context.createMediaElementSource(element);
  } catch (error) {
    // Someone else got there first, and the element is now permanently
    // unroutable. Remember it so no later attempt wastes another AudioContext
    // on it: Chrome allows only a handful per page.
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

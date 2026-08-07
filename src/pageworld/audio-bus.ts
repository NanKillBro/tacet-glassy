// The shared bus, published as window.__blyricsAudio. First writer owns it;
// a sibling extension (better-lyrics-shaders) can attach to the same
// context and source without either side knowing about the other's graph.
//
// Real DOM and Web Audio calls only: the claim decision and element
// selection are pure and live in audio-bus-claim.ts and
// select-media-element.ts. Not unit-testable, no AudioContext in Node.

import { decideAudioBusClaim } from "@/pageworld/audio-bus-claim";
import { selectPlaybackElement } from "@/pageworld/select-media-element";

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

// Never create a source node on a suspended context: routing audio into a
// dead context silences playback entirely. Resume first, verify running,
// only then take the source.
// YouTube Music swaps its media element, and the source-node binding is
// permanent, so a bus taken before playback started ends up holding a dead
// element. The real element then plays through its own path untouched, which
// sounds exactly like the feature doing nothing. A bus whose element is no
// longer the live one is stale and must be rebuilt against the current
// element, which is itself unbound and therefore claimable.
function isLiveElement(element: HTMLMediaElement): boolean {
  const decoded = (element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount;
  return element.isConnected && (decoded ?? 0) > 0;
}

async function acquireAudioBus(): Promise<BlyricsAudioBus | null> {
  const existing = readWindowBus();
  const claim = decideAudioBusClaim(existing, AUDIO_BUS_VERSION, isBlyricsAudioBus);

  if (claim === "incompatible") return null;

  if (claim === "reuse") {
    const bus = existing as BlyricsAudioBus;
    if (isLiveElement(bus.element)) {
      return (await resumeOnGesture(bus.context)) ? bus : null;
    }
    console.warn("[BLK-AUDIO-BUS] bus element is stale, rebuilding against the current element");
  }

  const candidates = Array.from(document.querySelectorAll("video"));
  // Refuse to bind before the element is actually decoding audio. Binding
  // early is what produced the stale bus above, and the binding cannot be
  // undone.
  const element = selectPlaybackElement(candidates.filter(isLiveElement)) ?? null;
  if (!element) return null;

  const context = new AudioContext();
  if (!(await resumeOnGesture(context))) return null;

  const source = context.createMediaElementSource(element);
  source.connect(context.destination);

  const bus: BlyricsAudioBus = { version: AUDIO_BUS_VERSION, context, source, element };
  writeWindowBus(bus);
  return bus;
}

export { AUDIO_BUS_VERSION, AUDIO_BUS_KEY, acquireAudioBus, isBlyricsAudioBus };
export type { BlyricsAudioBus };

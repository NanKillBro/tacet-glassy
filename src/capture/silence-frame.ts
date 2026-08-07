// Makes a worker frame incapable of producing sound.
//
// Setting video.muted once is not enough, and that is what shipped: the worker
// only muted its element after waitForPlayer() had found one that was already
// decoding, so everything before that point came out of the speakers, preroll
// ads included. YouTube Music also restores its own volume, so a single write
// is undone anyway.
//
// Overriding the accessors on the prototype closes both gaps at once: it is in
// place at document_start, before any element exists, and every later write by
// the player is forced back to silent. Only ever install this in a hidden
// worker frame; doing it on the page the listener is actually using would mute
// their music.
//
// Muting suppresses output only. The element still decodes and still fetches,
// which is the whole point: capture reads what the player downloads, not what
// it plays.

interface MediaElementLike {
  muted: boolean;
  volume: number;
}

type Setter = (this: unknown, value: never) => void;

function silenceElement(element: MediaElementLike): void {
  element.muted = true;
  element.volume = 0;
}

// Catches an element that autoplays from its attribute without anyone calling
// play(), which the prototype patch below would otherwise miss.
function silenceMediaIn(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll("video, audio"))) {
    silenceElement(element as unknown as MediaElementLike);
  }
}

// Takes the prototype rather than reaching for HTMLMediaElement itself, so the
// override can be exercised against a stand-in with the same accessor shape.
function installForcedSilence(prototype: object): boolean {
  const mutedDescriptor = Object.getOwnPropertyDescriptor(prototype, "muted");
  const volumeDescriptor = Object.getOwnPropertyDescriptor(prototype, "volume");
  const setMuted = mutedDescriptor?.set as Setter | undefined;
  const setVolume = volumeDescriptor?.set as Setter | undefined;

  // Without the real setters there is no way to actually silence anything, and
  // a getter that merely claims to be muted would be worse than doing nothing:
  // it would hide the problem from every check downstream.
  if (!setMuted || !setVolume) return false;

  Object.defineProperty(prototype, "muted", {
    configurable: true,
    enumerable: mutedDescriptor?.enumerable ?? false,
    get(): boolean {
      return true;
    },
    set(this: unknown): void {
      setMuted.call(this, true as never);
    },
  });

  Object.defineProperty(prototype, "volume", {
    configurable: true,
    enumerable: volumeDescriptor?.enumerable ?? false,
    get(): number {
      return 0;
    },
    set(this: unknown): void {
      setVolume.call(this, 0 as never);
    },
  });

  const originalPlay = (prototype as { play?: () => Promise<void> }).play;
  if (typeof originalPlay === "function") {
    (prototype as { play?: () => Promise<void> }).play = function (this: unknown): Promise<void> {
      setMuted.call(this, true as never);
      setVolume.call(this, 0 as never);
      return originalPlay.call(this);
    };
  }

  return true;
}

export { installForcedSilence, silenceMediaIn, silenceElement };
export type { MediaElementLike };

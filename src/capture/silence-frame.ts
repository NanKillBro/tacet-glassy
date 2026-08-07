// Makes a worker frame incapable of producing sound.
//
// Overriding the prototype accessors is in place at document_start, before any
// element exists, and forces every later write by the player back to silent.
// Setting video.muted once is not enough: nothing is muted until the element
// exists, and YouTube Music restores its own volume afterwards.
//
// Only ever install this in a hidden worker frame. Muting suppresses output
// only, so the element still decodes and fetches, which is what capture reads.

interface MediaElementLike {
  muted: boolean;
  volume: number;
}

type Setter = (this: unknown, value: never) => void;

function silenceElement(element: MediaElementLike): void {
  element.muted = true;
  element.volume = 0;
}

// Catches an element that autoplays from its attribute without calling play().
function silenceMediaIn(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll("video, audio"))) {
    silenceElement(element as unknown as MediaElementLike);
  }
}

// Takes the prototype so tests can pass a stand-in with the same accessor shape.
function installForcedSilence(prototype: object): boolean {
  const mutedDescriptor = Object.getOwnPropertyDescriptor(prototype, "muted");
  const volumeDescriptor = Object.getOwnPropertyDescriptor(prototype, "volume");
  const setMuted = mutedDescriptor?.set as Setter | undefined;
  const setVolume = volumeDescriptor?.set as Setter | undefined;

  // A getter that claims silence with no setter to enforce it would hide the
  // failure from every check downstream, so refuse instead.
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

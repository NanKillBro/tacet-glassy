// Decides who owns window.__blyricsAudio, without touching the DOM or Web
// Audio: audio-bus.ts does the actual AudioContext/element work, this module
// only answers "create, reuse, or refuse" given whatever is already there.
//
// A version mismatch is treated the same as an incompatible shape rather
// than an upgrade: createMediaElementSource can only ever be called once per
// element, so if the existing bus does not match our contract there is no
// safe way to build a second one. The caller falls back to the unavailable
// state instead.

type AudioBusClaim = "create" | "reuse" | "incompatible";

function decideAudioBusClaim(
  existing: unknown,
  expectedVersion: number,
  isCompatibleShape: (value: unknown) => value is { version: number }
): AudioBusClaim {
  if (existing === undefined || existing === null) return "create";
  if (!isCompatibleShape(existing)) return "incompatible";
  return existing.version === expectedVersion ? "reuse" : "incompatible";
}

export { decideAudioBusClaim };
export type { AudioBusClaim };

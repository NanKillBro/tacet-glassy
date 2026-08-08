// Which track an in-flight hidden-player capture belongs to, and whether a new
// request may have it.
//
// The in-flight promise used to be a bare singleton with no identity, so a track
// change mid-capture handed the previous track's audio to the new track, which
// separated it and cached the result under the new track's key. Refusing is
// correct rather than queueing: only one hidden player runs at a time, and the
// listener's own playback is already the fallback.

type PrefetchDecision = "start" | "reuse" | "refuse";

function decidePrefetch(inFlightVideoId: string | null, requestedVideoId: string): PrefetchDecision {
  if (inFlightVideoId === null) return "start";
  return inFlightVideoId === requestedVideoId ? "reuse" : "refuse";
}

export { decidePrefetch };
export type { PrefetchDecision };

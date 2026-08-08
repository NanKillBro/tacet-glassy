// -- Prefetch gate -----------------------------------------------------------

type PrefetchDecision = "start" | "reuse" | "refuse" | "supersede";

interface PrefetchRequest {
  inFlightVideoId: string | null;
  inFlightIsAhead: boolean;
  requestedVideoId: string;
  requestedIsAhead: boolean;
}

function decidePrefetch(request: PrefetchRequest): PrefetchDecision {
  if (request.inFlightVideoId === null) return "start";
  if (request.inFlightVideoId === request.requestedVideoId) return "reuse";
  if (!request.requestedIsAhead) return "supersede";
  return request.inFlightIsAhead ? "supersede" : "refuse";
}

export { decidePrefetch };
export type { PrefetchDecision, PrefetchRequest };

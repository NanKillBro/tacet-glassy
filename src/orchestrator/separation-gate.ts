// The WebGPU execution provider fails outright on a second concurrent session,
// and two captures for one track both name the same videoId.

type SeparationStart = "start" | "ignore" | "supersede";

function decideSeparationStart(runningVideoId: string | null, requestedVideoId: string): SeparationStart {
  if (runningVideoId === null) return "start";
  return runningVideoId === requestedVideoId ? "ignore" : "supersede";
}

export { decideSeparationStart };
export type { SeparationStart };

// The WebGPU execution provider fails outright on a second concurrent session,
// and two captures for one track both name the same videoId.

type SeparationStart = "start" | "ignore" | "supersede";

function decideSeparationStart(runningVideoId: string | null, requestedVideoId: string): SeparationStart {
  if (runningVideoId === null) return "start";
  return runningVideoId === requestedVideoId ? "ignore" : "supersede";
}

const OPENING_STAGE = "checking-cache";

function shouldRepublishStage(stage: string | null): boolean {
  return stage !== null && stage !== OPENING_STAGE;
}

export { decideSeparationStart, shouldRepublishStage, OPENING_STAGE };
export type { SeparationStart };

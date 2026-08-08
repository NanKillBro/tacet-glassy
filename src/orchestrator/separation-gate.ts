// Whether a completed capture may start a separation right now.
//
// The WebGPU execution provider refuses to build a second inference session
// while one is being created ("another WebGPU EP inference session is being
// created"), so overlapping runs do not merely waste a GPU, they fail. Two
// captures for the same track arriving back to back is the case the videoId
// check alone never caught, since both name the same track.

type SeparationStart = "start" | "ignore" | "supersede";

function decideSeparationStart(runningVideoId: string | null, requestedVideoId: string): SeparationStart {
  if (runningVideoId === null) return "start";
  return runningVideoId === requestedVideoId ? "ignore" : "supersede";
}

export { decideSeparationStart };
export type { SeparationStart };

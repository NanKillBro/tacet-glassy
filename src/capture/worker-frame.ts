// Marks a hidden worker frame and carries its slice assignment in the URL.
//
// The worker runs the same MAIN-world capture script as the real page, so it
// needs a way to know it is a worker before the player boots. A query parameter
// is the only channel available at document_start, and it survives the
// navigation that would discard anything set on the window.

const WORKER_PARAM = "blk-slice";
const WATCH_URL = "https://music.youtube.com/watch";

interface WorkerAssignment {
  index: number;
  fromSeconds: number;
  toSeconds: number;
}

function buildWorkerUrl(videoId: string, assignment: WorkerAssignment): string {
  const url = new URL(WATCH_URL);
  url.searchParams.set("v", videoId);
  url.searchParams.set(
    WORKER_PARAM,
    `${assignment.index}:${assignment.fromSeconds.toFixed(3)}:${assignment.toSeconds.toFixed(3)}`
  );
  return url.toString();
}

function readWorkerAssignment(search: string): WorkerAssignment | null {
  const raw = new URLSearchParams(search).get(WORKER_PARAM);
  if (!raw) return null;

  const parts = raw.split(":");
  if (parts.length !== 3) return null;

  const [index, fromSeconds, toSeconds] = parts.map(Number);
  if (!Number.isInteger(index) || index < 0) return null;
  if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds)) return null;
  if (fromSeconds < 0 || toSeconds <= fromSeconds) return null;

  return { index, fromSeconds, toSeconds };
}

function isWorkerFrame(search: string): boolean {
  return readWorkerAssignment(search) !== null;
}

export { buildWorkerUrl, readWorkerAssignment, isWorkerFrame, WORKER_PARAM };
export type { WorkerAssignment };

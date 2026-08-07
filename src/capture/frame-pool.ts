// Spawns the hidden worker players and collects their slices.
//
// Each worker is an ordinary same-origin YouTube Music page carrying a slice
// marker, so the capture content script runs inside it at document_start and
// owns its own SourceBuffer patch. That is the only race-free way to install
// the patch before the player builds its buffers; patching a child frame from
// here would be a poll against the player's boot.

import { log } from "@/capture/log";
import type { SlicePlan } from "@/capture/slice-plan";
import { buildWorkerUrl } from "@/capture/worker-frame";
import { isSliceCapturedMessage } from "@/capture/bridge-protocol";

interface CapturedSlice {
  index: number;
  startSeconds: number;
  mimeType: string;
  bytes: ArrayBuffer;
}

interface SliceCaptureOptions {
  videoId: string;
  slices: SlicePlan[];
  timeoutMs?: number;
  signal?: AbortSignal;
  onSliceDone?: (done: number, total: number) => void;
}

const FRAME_ID_PREFIX = "blyrics-karaoke-worker-";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// Inside the viewport, but tiny and effectively invisible. display:none and
// off-viewport placement both leave the frame's media eligible to be paused:
// a worker parked at left:-10000px had its play() interrupted by a pause it
// never requested, and never recovered. Staying laid out and intersecting the
// viewport is what keeps the player running.
const FRAME_STYLE =
  "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;border:0;z-index:-1";

function createWorkerFrame(videoId: string, slice: SlicePlan): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.id = `${FRAME_ID_PREFIX}${slice.index}`;
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText = FRAME_STYLE;
  frame.src = buildWorkerUrl(videoId, slice);
  return frame;
}

function captureTrackInSlices(options: SliceCaptureOptions): Promise<CapturedSlice[]> {
  const { videoId, slices, timeoutMs = DEFAULT_TIMEOUT_MS, signal, onSliceDone } = options;

  return new Promise(resolve => {
    if (slices.length === 0) {
      resolve([]);
      return;
    }

    const collected = new Map<number, CapturedSlice>();
    const frames = slices.map(slice => createWorkerFrame(videoId, slice));
    let settled = false;

    const finish = (reason: string) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      for (const frame of frames) frame.remove();
      const result = [...collected.values()].sort((a, b) => a.index - b.index);
      log(`slice capture ${reason}: ${result.length}/${slices.length} slices for videoId=${videoId}`);
      resolve(result);
    };

    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) return;
      const data: unknown = event.data;
      if (!isSliceCapturedMessage(data) || data.videoId !== videoId) return;
      if (collected.has(data.index)) return;

      collected.set(data.index, {
        index: data.index,
        startSeconds: data.startSeconds,
        mimeType: data.mimeType,
        bytes: data.bytes,
      });
      onSliceDone?.(collected.size, slices.length);
      if (collected.size === slices.length) finish("complete");
    }

    function onAbort(): void {
      collected.clear();
      finish("aborted");
    }

    // A partial result is still useful: the separation path can work with the
    // slices that landed, so a single wedged worker does not lose the track.
    const timer = setTimeout(() => finish("timed out"), timeoutMs);

    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    for (const frame of frames) document.body.appendChild(frame);
    log(`spawned ${frames.length} worker frames for videoId=${videoId}`);
  });
}

export { captureTrackInSlices, FRAME_ID_PREFIX };
export type { CapturedSlice, SliceCaptureOptions };

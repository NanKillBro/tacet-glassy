// Owns retained capture state for exactly one track at a time. Keying off
// video id means a track change starts a fresh capture without the patch
// layer having to notice navigation itself: it just calls setActiveVideoId
// on every append and this decides whether that is a reset.
//
// appendCount and totalBytes track the raw stream, uncapped, because "did
// capture see the bytes" and "can we afford to keep them" are different
// questions. Only the chunks array (what decode.ts reads) is capped.

import { looksLikeInitSegment } from "@/capture/init-segment";

const DEFAULT_MAX_RETAINED_BYTES = 64 * 1024 * 1024;

interface CaptureChunk {
  bytes: Uint8Array;
  isInitSegment: boolean;
}

interface CaptureStats {
  videoId: string | null;
  appendCount: number;
  totalBytes: number;
  mimeTypes: string[];
  retainedChunkCount: number;
  initSegmentCount: number;
  hitCap: boolean;
}

type AddChunkResult = "added" | "cap-hit" | "cap-already-hit";

interface CaptureAccumulator {
  setActiveVideoId(videoId: string): boolean;
  addChunk(mimeType: string, bytes: Uint8Array): AddChunkResult;
  getChunks(): CaptureChunk[];
  getStats(): CaptureStats;
}

function createCaptureAccumulator(maxRetainedBytes: number = DEFAULT_MAX_RETAINED_BYTES): CaptureAccumulator {
  let videoId: string | null = null;
  let chunks: CaptureChunk[] = [];
  let retainedBytes = 0;
  let appendCount = 0;
  let totalBytes = 0;
  let hitCap = false;
  const mimeTypes = new Set<string>();

  function resetState(): void {
    chunks = [];
    retainedBytes = 0;
    appendCount = 0;
    totalBytes = 0;
    hitCap = false;
    mimeTypes.clear();
  }

  function setActiveVideoId(nextVideoId: string): boolean {
    if (nextVideoId === videoId) return false;
    videoId = nextVideoId;
    resetState();
    return true;
  }

  function addChunk(mimeType: string, bytes: Uint8Array): AddChunkResult {
    appendCount += 1;
    totalBytes += bytes.byteLength;
    mimeTypes.add(mimeType);

    if (hitCap) return "cap-already-hit";

    if (retainedBytes + bytes.byteLength > maxRetainedBytes) {
      hitCap = true;
      return "cap-hit";
    }

    chunks.push({ bytes, isInitSegment: looksLikeInitSegment(bytes) });
    retainedBytes += bytes.byteLength;
    return "added";
  }

  function getChunks(): CaptureChunk[] {
    return chunks.slice();
  }

  function getStats(): CaptureStats {
    return {
      videoId,
      appendCount,
      totalBytes,
      mimeTypes: Array.from(mimeTypes),
      retainedChunkCount: chunks.length,
      initSegmentCount: chunks.filter(chunk => chunk.isInitSegment).length,
      hitCap,
    };
  }

  return { setActiveVideoId, addChunk, getChunks, getStats };
}

export { DEFAULT_MAX_RETAINED_BYTES, createCaptureAccumulator };
export type { AddChunkResult, CaptureAccumulator, CaptureChunk, CaptureStats };

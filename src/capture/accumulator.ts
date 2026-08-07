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
  stoodDown: boolean;
}

type AddChunkResult = "added" | "cap-hit" | "cap-already-hit" | "stood-down";

interface CaptureAccumulator {
  setActiveVideoId(videoId: string): boolean;
  addChunk(mimeType: string, bytes: Uint8Array): AddChunkResult;
  getChunks(): CaptureChunk[];
  getStats(): CaptureStats;
  // Drops what is retained and stops retaining anything further for the track
  // now active, for when its stems have already been served from the cache.
  // Counters keep running, so the stream is still observable; only the memory
  // goes. A track change re-arms retention by itself.
  standDown(): void;
}

function createCaptureAccumulator(maxRetainedBytes: number = DEFAULT_MAX_RETAINED_BYTES): CaptureAccumulator {
  let videoId: string | null = null;
  let chunks: CaptureChunk[] = [];
  let retainedBytes = 0;
  let appendCount = 0;
  let totalBytes = 0;
  let hitCap = false;
  let stoodDown = false;
  const mimeTypes = new Set<string>();

  function resetState(): void {
    chunks = [];
    retainedBytes = 0;
    appendCount = 0;
    totalBytes = 0;
    hitCap = false;
    stoodDown = false;
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

    if (stoodDown) return "stood-down";
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

  function standDown(): void {
    stoodDown = true;
    chunks = [];
    retainedBytes = 0;
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
      stoodDown,
    };
  }

  return { setActiveVideoId, addChunk, getChunks, getStats, standDown };
}

export { DEFAULT_MAX_RETAINED_BYTES, createCaptureAccumulator };
export type { AddChunkResult, CaptureAccumulator, CaptureChunk, CaptureStats };

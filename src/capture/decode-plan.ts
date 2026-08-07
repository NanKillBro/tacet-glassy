// Builds the byte layouts for the two decode experiments this spike exists
// to run, plus the ABR-switch signal (experiment 4). Pure list surgery only:
// the actual decodeAudioData call lives in decode-experiment.ts, which needs
// a browser.

import type { CaptureChunk } from "@/capture/accumulator";

function planNaiveConcat(chunks: readonly CaptureChunk[]): Uint8Array[] {
  return chunks.map(chunk => chunk.bytes);
}

// The first captured buffer is assumed to be the initialization segment,
// per the reference implementation's convention, whether or not it happens
// to be tagged as one. Anything later that looks like another init segment
// is a mid-track re-initialization (an ABR switch) and is skipped so the
// remaining media segments stay addressed against the original init.
function planFirstPlusMedia(chunks: readonly CaptureChunk[]): Uint8Array[] {
  if (chunks.length === 0) return [];
  const [first, ...rest] = chunks;
  return [first.bytes, ...rest.filter(chunk => !chunk.isInitSegment).map(chunk => chunk.bytes)];
}

function countInitSegments(chunks: readonly CaptureChunk[]): number {
  return chunks.filter(chunk => chunk.isInitSegment).length;
}

function concatenateChunks(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return combined;
}

export { planNaiveConcat, planFirstPlusMedia, countInitSegments, concatenateChunks };

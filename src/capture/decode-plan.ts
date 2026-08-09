import type { CaptureChunk } from "@/capture/accumulator";

function planNaiveConcat(chunks: readonly CaptureChunk[]): Uint8Array[] {
  return chunks.map(chunk => chunk.bytes);
}

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

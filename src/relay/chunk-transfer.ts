// Carries a base64 payload across chrome.runtime messaging (JSON-only, see
// src/relay/base64.ts) as a sequence of small messages instead of one giant
// string. 512 KiB of base64 per chunk: comfortably under any known
// chrome.runtime message-size limit, and small enough that a single
// message's JSON.stringify does not stall the sender or the relay.
// Measured payloads (captured audio ~5.3 MB base64, both stems combined
// ~7.5 MB base64) land at roughly 10 to 15 chunks each way.

const DEFAULT_CHUNK_CHARS = 512 * 1024;

function splitIntoChunks(data: string, chunkSize: number = DEFAULT_CHUNK_CHARS): string[] {
  if (chunkSize <= 0) {
    throw new Error(`chunk-transfer: chunkSize must be positive, got ${chunkSize}`);
  }
  if (data.length === 0) return [""];

  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(data.slice(offset, offset + chunkSize));
  }
  return chunks;
}

interface ChunkAssembler {
  addChunk(index: number, total: number, data: string): void;
  isComplete(): boolean;
  assemble(): string;
  reset(): void;
}

function createChunkAssembler(): ChunkAssembler {
  const parts = new Map<number, string>();
  let expectedTotal: number | null = null;

  // A differing total means a NEW transfer, not a corrupt one. Re-engaging the
  // same track, or a retry after a failure, produces a second transfer whose
  // chunk count rarely matches the first. Treating that as corruption left the
  // assembler permanently poisoned by the abandoned transfer's chunks.
  function addChunk(index: number, total: number, data: string): void {
    if (index < 0 || index >= total) {
      throw new Error(`chunk-transfer: chunk index ${index} out of range for total ${total}`);
    }
    if (expectedTotal !== null && total !== expectedTotal) parts.clear();
    expectedTotal = total;
    parts.set(index, data);
  }

  function reset(): void {
    parts.clear();
    expectedTotal = null;
  }

  function isComplete(): boolean {
    return expectedTotal !== null && parts.size === expectedTotal;
  }

  function assemble(): string {
    if (!isComplete() || expectedTotal === null) {
      throw new Error("chunk-transfer: cannot assemble, transfer is incomplete or missing chunks");
    }
    let result = "";
    for (let i = 0; i < expectedTotal; i++) result += parts.get(i);
    return result;
  }

  return { addChunk, isComplete, assemble, reset };
}

export { DEFAULT_CHUNK_CHARS, splitIntoChunks, createChunkAssembler };
export type { ChunkAssembler };

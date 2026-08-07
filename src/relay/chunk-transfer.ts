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
}

function createChunkAssembler(): ChunkAssembler {
  const parts = new Map<number, string>();
  let expectedTotal: number | null = null;

  function addChunk(index: number, total: number, data: string): void {
    if (expectedTotal !== null && total !== expectedTotal) {
      throw new Error(`chunk-transfer: inconsistent total, expected ${expectedTotal}, got ${total}`);
    }
    if (index < 0 || index >= total) {
      throw new Error(`chunk-transfer: chunk index ${index} out of range for total ${total}`);
    }
    expectedTotal = total;
    parts.set(index, data);
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

  return { addChunk, isComplete, assemble };
}

export { DEFAULT_CHUNK_CHARS, splitIntoChunks, createChunkAssembler };
export type { ChunkAssembler };

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

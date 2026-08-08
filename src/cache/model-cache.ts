import { MODEL_STORE_NAME, openDB } from "@/cache/idb";
import { digestsMatch, sha256Hex } from "@/cache/model-digest";

// Ported from composer src/audio/separation/model-cache.ts. Composer keys the
// cache on a ModelDescriptor and stores bytes via the Cache API; there is no
// model-registry equivalent here (a single htdemucs_fp32.onnx, not a variant
// set), so this keys directly on the fetch url and stores in IndexedDB via
// idb.ts, per the design doc's extension-origin cache decision.

const APPROX_MODEL_BYTES = 83 * 1024 * 1024;

interface ModelCacheRecord {
  bytes: Blob;
  updatedAt: number;
}

type DownloadProgress = (loaded: number, total: number) => void;

// -- Validation -----------------------------------------------------------------

function isValidModelCacheRecord(value: unknown): value is ModelCacheRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.bytes instanceof Blob && typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt);
}

// -- Reads -----------------------------------------------------------------

async function readModelRecord(url: string): Promise<ModelCacheRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE_NAME, "readonly");
    const request = tx.objectStore(MODEL_STORE_NAME).get(url);
    request.onerror = () => reject(request.error ?? new Error(`model-cache: get failed for ${url}`));
    request.onsuccess = () => resolve(isValidModelCacheRecord(request.result) ? request.result : null);
    tx.oncomplete = () => db.close();
  });
}

async function hasCachedModel(url: string): Promise<boolean> {
  return (await readModelRecord(url)) !== null;
}

async function readCachedModel(url: string): Promise<ArrayBuffer | null> {
  const record = await readModelRecord(url);
  if (record === null) return null;
  return record.bytes.arrayBuffer();
}

async function getCachedModelSize(url: string): Promise<number | null> {
  const record = await readModelRecord(url);
  return record === null ? null : record.bytes.size;
}

// -- Writes -----------------------------------------------------------------

async function verifyAndWriteModel(url: string, bytes: Uint8Array<ArrayBuffer>, expectedSha256: string): Promise<void> {
  const digest = await sha256Hex(bytes);
  if (!digestsMatch(digest, expectedSha256)) {
    throw new Error(`model-cache: ${bytes.byteLength} bytes hashed to ${digest}, expected ${expectedSha256}`);
  }
  await writeModelRecord(url, bytes);
}

async function writeModelRecord(url: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const record: ModelCacheRecord = {
    bytes: new Blob([bytes]),
    updatedAt: Date.now(),
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE_NAME, "readwrite");
    tx.objectStore(MODEL_STORE_NAME).put(record, url);
    tx.onerror = () => reject(tx.error ?? new Error(`model-cache: put failed for ${url}`));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

// -- Fetch and cache -----------------------------------------------------------------

async function fetchAndCacheModel(
  url: string,
  signal: AbortSignal,
  onProgress: DownloadProgress,
  expectedSha256: string
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`model-cache: fetch failed (${response.status} ${response.statusText})`);
  }

  const contentLengthHeader = response.headers.get("content-length");
  const total = contentLengthHeader ? Number(contentLengthHeader) : APPROX_MODEL_BYTES;

  const reader = response.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await response.arrayBuffer());
    onProgress(buf.byteLength, buf.byteLength);
    await verifyAndWriteModel(url, buf, expectedSha256);
    return buf.buffer;
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (signal.aborted) {
      reader.cancel().catch(() => {});
      throw new DOMException("Aborted", "AbortError");
    }
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  await verifyAndWriteModel(url, merged, expectedSha256);
  return merged.buffer;
}

// -- Clearing (settings UI) -----------------------------------------------------

async function clearCachedModel(url: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE_NAME, "readwrite");
    tx.objectStore(MODEL_STORE_NAME).delete(url);
    tx.onerror = () => reject(tx.error ?? new Error(`model-cache: clear failed for ${url}`));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

export {
  hasCachedModel,
  readCachedModel,
  fetchAndCacheModel,
  getCachedModelSize,
  clearCachedModel,
  APPROX_MODEL_BYTES,
};

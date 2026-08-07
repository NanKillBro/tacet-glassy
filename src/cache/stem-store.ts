import { openDB, STEMS_STORE_NAME } from "@/cache/idb";

interface StemRecord {
  vocals: Blob;
  instrumental: Blob;
  framesDone: number;
  totalFrames: number;
  bytes: number;
  updatedAt: number;
}

interface StemRecordInput {
  vocals: Blob;
  instrumental: Blob;
  framesDone: number;
  totalFrames: number;
}

const DEFAULT_BUDGET_BYTES = 250 * 1024 * 1024;

// -- Validation -----------------------------------------------------------------

function isValidStemRecord(value: unknown): value is StemRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.vocals instanceof Blob &&
    record.instrumental instanceof Blob &&
    typeof record.framesDone === "number" &&
    Number.isFinite(record.framesDone) &&
    typeof record.totalFrames === "number" &&
    Number.isFinite(record.totalFrames) &&
    typeof record.bytes === "number" &&
    Number.isFinite(record.bytes) &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt)
  );
}

// -- Reads -----------------------------------------------------------------

async function getStemRecord(contentKey: string): Promise<StemRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STEMS_STORE_NAME, "readonly");
    const store = tx.objectStore(STEMS_STORE_NAME);
    const request = store.get(contentKey);
    request.onerror = () => reject(request.error ?? new Error(`stem-store: get failed for ${contentKey}`));
    request.onsuccess = () => resolve(isValidStemRecord(request.result) ? request.result : null);
    tx.oncomplete = () => db.close();
  });
}

// -- Writes -----------------------------------------------------------------

async function putStemRecord(
  contentKey: string,
  input: StemRecordInput,
  budgetBytes: number = DEFAULT_BUDGET_BYTES
): Promise<void> {
  if (input.framesDone > input.totalFrames) {
    throw new Error(
      `stem-store: framesDone (${input.framesDone}) cannot exceed totalFrames (${input.totalFrames}) for ${contentKey}`
    );
  }
  if (budgetBytes < 0) {
    throw new Error(`stem-store: budgetBytes must be non-negative, got ${budgetBytes}`);
  }

  const existing = await getStemRecord(contentKey);
  if (existing !== null && input.framesDone < existing.framesDone) {
    throw new Error(
      `stem-store: framesDone cannot move backwards for ${contentKey} (existing ${existing.framesDone}, incoming ${input.framesDone})`
    );
  }

  const record: StemRecord = {
    vocals: input.vocals,
    instrumental: input.instrumental,
    framesDone: input.framesDone,
    totalFrames: input.totalFrames,
    bytes: input.vocals.size + input.instrumental.size,
    updatedAt: Date.now(),
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STEMS_STORE_NAME, "readwrite");
    tx.objectStore(STEMS_STORE_NAME).put(record, contentKey);
    tx.onerror = () => reject(tx.error ?? new Error(`stem-store: put failed for ${contentKey}`));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });

  await evictUntilWithinBudget(budgetBytes);
}

// -- Eviction -----------------------------------------------------------------

interface StoredEntry {
  key: IDBValidKey;
  bytes: number;
  updatedAt: number;
}

async function readAllEntries(): Promise<StoredEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STEMS_STORE_NAME, "readonly");
    const store = tx.objectStore(STEMS_STORE_NAME);
    const entries: StoredEntry[] = [];
    const cursorRequest = store.openCursor();
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("stem-store: cursor failed"));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor === null) {
        resolve(entries);
        return;
      }
      if (isValidStemRecord(cursor.value)) {
        entries.push({ key: cursor.key, bytes: cursor.value.bytes, updatedAt: cursor.value.updatedAt });
      }
      cursor.continue();
    };
    tx.oncomplete = () => db.close();
  });
}

async function deleteEntries(keys: IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STEMS_STORE_NAME, "readwrite");
    const store = tx.objectStore(STEMS_STORE_NAME);
    for (const key of keys) store.delete(key);
    tx.onerror = () => reject(tx.error ?? new Error("stem-store: eviction failed"));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

async function evictUntilWithinBudget(budgetBytes: number): Promise<void> {
  const entries = await readAllEntries();
  let totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (totalBytes <= budgetBytes) return;

  const oldestFirst = [...entries].sort((a, b) => a.updatedAt - b.updatedAt);
  const keysToEvict: IDBValidKey[] = [];
  for (const entry of oldestFirst) {
    if (totalBytes <= budgetBytes) break;
    keysToEvict.push(entry.key);
    totalBytes -= entry.bytes;
  }

  await deleteEntries(keysToEvict);
}

export { getStemRecord, putStemRecord, DEFAULT_BUDGET_BYTES };
export type { StemRecord, StemRecordInput };

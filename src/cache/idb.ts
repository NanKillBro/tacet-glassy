const DB_NAME = "blk-cache";
const DB_VERSION = 4;
const STEMS_STORE_NAME = "stems";
const ALIASES_STORE_NAME = "aliases";
const MODEL_STORE_NAME = "model";

// Stems cached before version 4 hold Opus blobs in the pre-fix packet stream
// format (decoder configured from the encoder's input rate instead of its
// own metadata). Those blobs cannot be decoded under the new format, so the
// store is dropped and recreated empty on upgrade past this version rather
// than left to serve stale, unreadable records.
const STEMS_FORMAT_MIGRATION_VERSION = 4;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("idb: failed to open database"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = event => {
      const db = request.result;
      if (event.oldVersion < STEMS_FORMAT_MIGRATION_VERSION && db.objectStoreNames.contains(STEMS_STORE_NAME)) {
        db.deleteObjectStore(STEMS_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(STEMS_STORE_NAME)) {
        db.createObjectStore(STEMS_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(ALIASES_STORE_NAME)) {
        db.createObjectStore(ALIASES_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(MODEL_STORE_NAME)) {
        db.createObjectStore(MODEL_STORE_NAME);
      }
    };
  });
}

export { DB_NAME, DB_VERSION, STEMS_STORE_NAME, ALIASES_STORE_NAME, MODEL_STORE_NAME, openDB };

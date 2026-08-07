const DB_NAME = "blk-cache";
const DB_VERSION = 3;
const STEMS_STORE_NAME = "stems";
const ALIASES_STORE_NAME = "aliases";
const MODEL_STORE_NAME = "model";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("idb: failed to open database"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
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

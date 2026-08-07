const DB_NAME = "blk-cache";
const DB_VERSION = 1;
const STEMS_STORE_NAME = "stems";

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
    };
  });
}

export { DB_NAME, DB_VERSION, STEMS_STORE_NAME, openDB };

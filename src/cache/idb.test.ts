import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { ALIASES_STORE_NAME, DB_NAME, DB_VERSION, MODEL_STORE_NAME, openDB, STEMS_STORE_NAME } from "@/cache/idb";

// -- Test helpers -----------------------------------------------------------------

const PRE_MIGRATION_VERSION = 3;

function openLegacyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, PRE_MIGRATION_VERSION);
    request.onerror = () => reject(request.error ?? new Error("idb.test: failed to open legacy database"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STEMS_STORE_NAME)) db.createObjectStore(STEMS_STORE_NAME);
      if (!db.objectStoreNames.contains(ALIASES_STORE_NAME)) db.createObjectStore(ALIASES_STORE_NAME);
      if (!db.objectStoreNames.contains(MODEL_STORE_NAME)) db.createObjectStore(MODEL_STORE_NAME);
    };
  });
}

function putRaw(db: IDBDatabase, storeName: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.onerror = () => reject(tx.error ?? new Error(`idb.test: put failed for ${key}`));
    tx.oncomplete = () => resolve();
  });
}

function getRaw(db: IDBDatabase, storeName: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onerror = () => reject(request.error ?? new Error(`idb.test: get failed for ${key}`));
    request.onsuccess = () => resolve(request.result);
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// -- happy path -----------------------------------------------------------------

describe("happy path", () => {
  it("opens a fresh database with all three stores at the current version", async () => {
    const db = await openDB();
    expect(db.objectStoreNames.contains(STEMS_STORE_NAME)).toBe(true);
    expect(db.objectStoreNames.contains(ALIASES_STORE_NAME)).toBe(true);
    expect(db.objectStoreNames.contains(MODEL_STORE_NAME)).toBe(true);
    expect(db.version).toBe(DB_VERSION);
    db.close();
  });
});

// -- stems format migration -----------------------------------------------------------------

describe("stems format migration", () => {
  it("drops stems cached before the packet stream format changed", async () => {
    const legacyDb = await openLegacyDB();
    await putRaw(legacyDb, STEMS_STORE_NAME, "content-a", { legacy: true });
    legacyDb.close();

    const db = await openDB();
    expect(await getRaw(db, STEMS_STORE_NAME, "content-a")).toBeUndefined();
    db.close();
  });

  it("preserves the videoId alias store across the migration", async () => {
    const legacyDb = await openLegacyDB();
    await putRaw(legacyDb, STEMS_STORE_NAME, "content-a", { legacy: true });
    await putRaw(legacyDb, ALIASES_STORE_NAME, "video-a", "content-a");
    legacyDb.close();

    const db = await openDB();
    expect(await getRaw(db, ALIASES_STORE_NAME, "video-a")).toBe("content-a");
    db.close();
  });

  it("does not wipe stems on a normal reopen already at the current version", async () => {
    const first = await openDB();
    await putRaw(first, STEMS_STORE_NAME, "content-a", { current: true });
    first.close();

    const second = await openDB();
    expect(await getRaw(second, STEMS_STORE_NAME, "content-a")).toEqual({ current: true });
    second.close();
  });
});

// -- edge cases -----------------------------------------------------------------

describe("edge cases", () => {
  it("does nothing to the stems store when it never existed on a legacy database", async () => {
    const legacyDb = await openLegacyDB();
    legacyDb.close();

    const db = await openDB();
    expect(db.objectStoreNames.contains(STEMS_STORE_NAME)).toBe(true);
    db.close();
  });
});

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB, STEMS_STORE_NAME } from "@/cache/idb";
import { DEFAULT_BUDGET_BYTES, getStemRecord, putStemRecord } from "@/cache/stem-store";
import type { StemRecordInput } from "@/cache/stem-store";

// -- Test helpers -----------------------------------------------------------------

function makeBlob(sizeBytes: number, fillByte = 1): Blob {
  return new Blob([new Uint8Array(sizeBytes).fill(fillByte)]);
}

function makeInput(overrides: Partial<StemRecordInput> = {}): StemRecordInput {
  return {
    vocals: makeBlob(100, 1),
    instrumental: makeBlob(100, 2),
    framesDone: 1000,
    totalFrames: 1000,
    ...overrides,
  };
}

async function putRaw(contentKey: string, value: unknown): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STEMS_STORE_NAME, "readwrite");
    tx.objectStore(STEMS_STORE_NAME).put(value, contentKey);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

let currentTime = 1_700_000_000_000;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  currentTime = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => currentTime++);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -- happy path -----------------------------------------------------------------

describe("happy path", () => {
  it("put and get round-trip", async () => {
    const input = makeInput();
    await putStemRecord("content-a", input);
    const record = await getStemRecord("content-a");

    expect(record).not.toBeNull();
    expect(record?.framesDone).toBe(1000);
    expect(record?.totalFrames).toBe(1000);
    expect(record?.bytes).toBe(200);
    expect(await record?.vocals.arrayBuffer()).toEqual(await input.vocals.arrayBuffer());
    expect(await record?.instrumental.arrayBuffer()).toEqual(await input.instrumental.arrayBuffer());
  });

  it("a complete record reads back complete", async () => {
    await putStemRecord("content-a", makeInput({ framesDone: 500, totalFrames: 500 }));
    const record = await getStemRecord("content-a");
    expect(record?.framesDone).toBe(record?.totalFrames);
  });
});

// -- prefix behaviour -----------------------------------------------------------------

describe("prefix behaviour", () => {
  it("a partial record reads back with the right framesDone", async () => {
    await putStemRecord("content-a", makeInput({ framesDone: 250, totalFrames: 1000 }));
    const record = await getStemRecord("content-a");
    expect(record?.framesDone).toBe(250);
    expect(record?.totalFrames).toBe(1000);
  });

  it("extending a prefix replaces the blobs and advances framesDone", async () => {
    await putStemRecord("content-a", makeInput({ vocals: makeBlob(50, 9), framesDone: 250, totalFrames: 1000 }));
    await putStemRecord("content-a", makeInput({ vocals: makeBlob(80, 5), framesDone: 600, totalFrames: 1000 }));

    const record = await getStemRecord("content-a");
    expect(record?.framesDone).toBe(600);
    expect(record?.vocals.size).toBe(80);
    const bytes = new Uint8Array(await (record?.vocals as Blob).arrayBuffer());
    expect(bytes[0]).toBe(5);
  });

  it("extending never moves framesDone backwards", async () => {
    await putStemRecord("content-a", makeInput({ framesDone: 600, totalFrames: 1000 }));
    await expect(putStemRecord("content-a", makeInput({ framesDone: 300, totalFrames: 1000 }))).rejects.toThrow(
      /backwards/i
    );
  });
});

// -- eviction -----------------------------------------------------------------

describe("eviction", () => {
  it("evicts oldest first until under budget", async () => {
    await putStemRecord("content-a", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }));
    await putStemRecord("content-b", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }));
    await putStemRecord("content-c", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }), 450);

    expect(await getStemRecord("content-a")).toBeNull();
    expect(await getStemRecord("content-b")).not.toBeNull();
    expect(await getStemRecord("content-c")).not.toBeNull();
  });

  it("evicts whole records, never half of one", async () => {
    await putStemRecord("content-a", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }));
    await putStemRecord("content-b", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }), 200);

    const survivor = await getStemRecord("content-b");
    expect(survivor).not.toBeNull();
    expect(survivor?.vocals.size).toBe(100);
    expect(survivor?.instrumental.size).toBe(100);
    expect(survivor?.bytes).toBe(200);
  });

  it("a budget smaller than a single record does not loop forever and does not throw", async () => {
    await expect(
      putStemRecord("content-a", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }), 10)
    ).resolves.toBeUndefined();
    expect(await getStemRecord("content-a")).toBeNull();
  });

  it("eviction leaves the most recently updated record alive", async () => {
    await putStemRecord("content-a", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }));
    await putStemRecord("content-b", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }));
    await putStemRecord("content-c", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }), 200);

    expect(await getStemRecord("content-a")).toBeNull();
    expect(await getStemRecord("content-b")).toBeNull();
    expect(await getStemRecord("content-c")).not.toBeNull();
  });
});

// -- edge cases -----------------------------------------------------------------

describe("edge cases", () => {
  it("empty store returns null", async () => {
    expect(await getStemRecord("nothing-here")).toBeNull();
  });

  it("totalFrames of zero is valid and reads back complete", async () => {
    await putStemRecord("content-a", makeInput({ framesDone: 0, totalFrames: 0 }));
    const record = await getStemRecord("content-a");
    expect(record?.framesDone).toBe(0);
    expect(record?.totalFrames).toBe(0);
  });

  it("handles stem blobs that differ in size", async () => {
    await putStemRecord("content-a", makeInput({ vocals: makeBlob(30), instrumental: makeBlob(90) }));
    const record = await getStemRecord("content-a");
    expect(record?.vocals.size).toBe(30);
    expect(record?.instrumental.size).toBe(90);
    expect(record?.bytes).toBe(120);
  });
});

// -- error paths -----------------------------------------------------------------

describe("error paths", () => {
  it("throws when framesDone is greater than totalFrames", async () => {
    await expect(putStemRecord("content-a", makeInput({ framesDone: 10, totalFrames: 5 }))).rejects.toThrow(
      /framesDone/i
    );
  });

  it("throws for a negative budget", async () => {
    await expect(putStemRecord("content-a", makeInput(), -1)).rejects.toThrow(/budget/i);
  });

  it("reads a missing key in a non-empty store as absent", async () => {
    await putStemRecord("content-a", makeInput());
    expect(await getStemRecord("content-does-not-exist")).toBeNull();
  });

  it("reads a corrupt record as absent rather than crashing", async () => {
    await putRaw("content-corrupt", { garbage: true });
    await expect(getStemRecord("content-corrupt")).resolves.toBeNull();
  });
});

// -- invariants -----------------------------------------------------------------

describe("invariants", () => {
  it("total stored bytes never exceeds the budget after any put", async () => {
    const budget = 250;
    await putStemRecord("content-a", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }), budget);
    await putStemRecord("content-b", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }), budget);
    await putStemRecord("content-c", makeInput({ vocals: makeBlob(100), instrumental: makeBlob(100) }), budget);

    const keys = ["content-a", "content-b", "content-c"];
    const records = await Promise.all(keys.map(key => getStemRecord(key)));
    const totalBytes = records.reduce((sum, record) => sum + (record?.bytes ?? 0), 0);
    expect(totalBytes).toBeLessThanOrEqual(budget);
  });

  it("updatedAt is monotonic across writes to the same key", async () => {
    await putStemRecord("content-a", makeInput({ framesDone: 100, totalFrames: 1000 }));
    const first = await getStemRecord("content-a");
    await putStemRecord("content-a", makeInput({ framesDone: 200, totalFrames: 1000 }));
    const second = await getStemRecord("content-a");

    expect(second?.updatedAt).toBeGreaterThan(first?.updatedAt ?? Number.POSITIVE_INFINITY);
  });

  it("uses the default budget when none is provided", () => {
    expect(DEFAULT_BUDGET_BYTES).toBe(250 * 1024 * 1024);
  });
});

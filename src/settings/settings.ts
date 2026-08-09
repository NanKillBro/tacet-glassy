import { DEFAULT_BUDGET_BYTES } from "@/cache/stem-store";

// -- Storage key --------------------------------------------------------------

const SETTINGS_STORAGE_KEY = "blk-settings";

// -- Cache budget bounds and presets -------------------------------------------

const MIN_CACHE_BUDGET_BYTES = 50 * 1024 * 1024;
const MAX_CACHE_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;

const CACHE_BUDGET_PRESETS_BYTES: readonly number[] = [100, 250, 500, 1000, 2000].map(
  megabytes => megabytes * 1024 * 1024
);

// -- Settings shape -------------------------------------------------------------

interface Settings {
  singAlongEnabled: boolean;
  autoSeparateEnabled: boolean;
  cacheBudgetBytes: number;
}

const DEFAULT_SETTINGS: Settings = {
  singAlongEnabled: true,
  autoSeparateEnabled: true,
  cacheBudgetBytes: DEFAULT_BUDGET_BYTES,
};

// -- Validation -----------------------------------------------------------------

function isValidCacheBudgetBytes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_CACHE_BUDGET_BYTES &&
    value <= MAX_CACHE_BUDGET_BYTES
  );
}

function sanitizeSettings(raw: unknown): Settings {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  return {
    singAlongEnabled:
      typeof record.singAlongEnabled === "boolean" ? record.singAlongEnabled : DEFAULT_SETTINGS.singAlongEnabled,
    autoSeparateEnabled:
      typeof record.autoSeparateEnabled === "boolean"
        ? record.autoSeparateEnabled
        : DEFAULT_SETTINGS.autoSeparateEnabled,
    cacheBudgetBytes: isValidCacheBudgetBytes(record.cacheBudgetBytes)
      ? record.cacheBudgetBytes
      : DEFAULT_SETTINGS.cacheBudgetBytes,
  };
}

// -- Eviction-on-budget-change decision ------------------------------------------

function shouldEvictForNewBudget(currentUsageBytes: number, newBudgetBytes: number): boolean {
  return currentUsageBytes > newBudgetBytes;
}

export {
  SETTINGS_STORAGE_KEY,
  MIN_CACHE_BUDGET_BYTES,
  MAX_CACHE_BUDGET_BYTES,
  CACHE_BUDGET_PRESETS_BYTES,
  DEFAULT_SETTINGS,
  isValidCacheBudgetBytes,
  sanitizeSettings,
  shouldEvictForNewBudget,
};
export type { Settings };

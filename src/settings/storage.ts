import { SETTINGS_STORAGE_KEY, sanitizeSettings } from "@/settings/settings";
import type { Settings } from "@/settings/settings";

// -- Storage read/write round trip -----------------------------------------------
//
// storageArea is an explicit parameter, never defaulted to chrome.storage.sync
// here, so this module never references the chrome global and stays testable
// with a plain fake. Call sites (popup, the content script gate, the offscreen
// document) pass chrome.storage.sync themselves.

interface SettingsStorageArea {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

async function loadSettingsFrom(storageArea: SettingsStorageArea): Promise<Settings> {
  const result = await storageArea.get(SETTINGS_STORAGE_KEY);
  return sanitizeSettings(result[SETTINGS_STORAGE_KEY]);
}

async function saveSettingsFrom(storageArea: SettingsStorageArea, partial: Partial<Settings>): Promise<Settings> {
  const current = await loadSettingsFrom(storageArea);
  const merged = sanitizeSettings({ ...current, ...partial });
  await storageArea.set({ [SETTINGS_STORAGE_KEY]: merged });
  return merged;
}

export { loadSettingsFrom, saveSettingsFrom };
export type { SettingsStorageArea };

import "./popup.css";
import { CACHE_BUDGET_PRESETS_BYTES, DEFAULT_SETTINGS } from "@/settings/settings";
import { formatBytes } from "@/settings/format-bytes";
import { loadSettingsFrom, saveSettingsFrom } from "@/settings/storage";
import {
  type ClearModelCacheCommand,
  type ClearStemCacheCommand,
  type GetCacheStatusCommand,
  isCacheStatusMessage,
  isClearCacheResultMessage,
} from "../workers/protocol2";

// -- Popup: settings and cache management --------------------------------------
//
// Plain HTML/TS popup (Plasmo auto-detects src/popup.ts as the popup entry
// and, since it is not a .tsx/.vue/.svelte file, ships it without a UI
// framework). Preferences round-trip through chrome.storage.sync via
// src/settings/storage.ts; cache byte totals and clears are read live from
// IndexedDB by routing through src/background.ts to the offscreen document,
// which is the only place that holds the connection (see workers/offscreen.ts).

const LOG_PREFIX = "[BLK-POPUP]";

// -- DOM helpers ------------------------------------------------------------

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

let labelIdCounter = 0;
function nextLabelId(): string {
  labelIdCounter++;
  return `blk-label-${labelIdCounter}`;
}

function createTextRow(labelText: string, hintText: string): { text: HTMLElement; hint: HTMLElement; labelId: string } {
  const text = createElement("div", "blk-row__text");
  const label = createElement("span", "blk-row__label");
  label.id = nextLabelId();
  label.textContent = labelText;
  const hint = createElement("span", "blk-row__hint");
  hint.textContent = hintText;
  text.append(label, hint);
  return { text, hint, labelId: label.id };
}

// -- Toggle switch ------------------------------------------------------------

interface Toggle {
  row: HTMLElement;
  setChecked(checked: boolean): void;
}

function createToggle(
  labelText: string,
  hintText: string,
  initialChecked: boolean,
  onToggle: (next: boolean) => void
): Toggle {
  const row = createElement("div", "blk-row");
  const { text, labelId } = createTextRow(labelText, hintText);

  const button = createElement("button", "blk-toggle");
  button.type = "button";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-labelledby", labelId);

  function render(checked: boolean): void {
    button.setAttribute("aria-checked", String(checked));
    button.classList.toggle("blk-toggle--on", checked);
  }
  render(initialChecked);

  button.addEventListener("click", () => {
    const next = button.getAttribute("aria-checked") !== "true";
    render(next);
    onToggle(next);
  });

  row.append(text, button);
  return { row, setChecked: render };
}

// -- Cache budget slider -------------------------------------------------------

interface BudgetSlider {
  row: HTMLElement;
}

function closestPresetIndex(presets: readonly number[], bytes: number): number {
  let closestIndex = 0;
  let closestDiff = Number.POSITIVE_INFINITY;
  presets.forEach((preset, index) => {
    const diff = Math.abs(preset - bytes);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = index;
    }
  });
  return closestIndex;
}

function createBudgetSlider(
  presets: readonly number[],
  initialBytes: number,
  onChange: (bytes: number) => void
): BudgetSlider {
  const row = createElement("div", "blk-row blk-row--stack");
  const { text, hint, labelId } = createTextRow("Cache budget", "");
  hint.textContent = "Maximum space used for cached vocals";

  const value = createElement("span", "blk-row__value");
  text.insertBefore(value, hint);

  const slider = createElement("input", "blk-slider");
  slider.type = "range";
  slider.setAttribute("aria-labelledby", labelId);
  slider.min = "0";
  slider.max = String(presets.length - 1);
  slider.step = "1";
  slider.value = String(closestPresetIndex(presets, initialBytes));
  value.textContent = formatBytes(presets[Number(slider.value)]);

  slider.addEventListener("input", () => {
    value.textContent = formatBytes(presets[Number(slider.value)]);
  });

  slider.addEventListener("change", () => {
    onChange(presets[Number(slider.value)]);
  });

  row.append(text, slider);
  return { row };
}

// -- Cache row (readout + clear button) ----------------------------------------

interface CacheRow {
  row: HTMLElement;
  setReadout(value: string): void;
  setClearDisabled(disabled: boolean): void;
}

function createCacheRow(labelText: string, onClear: () => void): CacheRow {
  const row = createElement("div", "blk-row");
  const { text, hint } = createTextRow(labelText, "Loading…");

  const clearButton = createElement("button", "blk-button");
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  clearButton.setAttribute("aria-label", `Clear ${labelText.toLowerCase()}`);
  clearButton.disabled = true;
  clearButton.addEventListener("click", onClear);

  row.append(text, clearButton);
  return {
    row,
    setReadout(valueText) {
      hint.textContent = valueText;
    },
    setClearDisabled(disabled) {
      clearButton.disabled = disabled;
    },
  };
}

// -- Main -----------------------------------------------------------------------

async function main(): Promise<void> {
  const root = createElement("div", "blk-popup");

  const header = createElement("div", "blk-popup__header");
  const title = createElement("span", "blk-popup__title");
  title.textContent = "Tacet for YouTube Music";
  header.append(title);

  const status = createElement("div", "blk-popup__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  function showStatus(message: string): void {
    status.textContent = message;
  }

  const settings = await loadSettingsFrom(chrome.storage.sync).catch(error => {
    console.error(`${LOG_PREFIX} failed to load settings`, error);
    showStatus("Could not load settings.");
    return DEFAULT_SETTINGS;
  });

  const singAlongToggle = createToggle(
    "Sing-along",
    "Master switch. Reload YouTube Music after changing this.",
    settings.singAlongEnabled,
    next => {
      saveSettingsFrom(chrome.storage.sync, { singAlongEnabled: next }).catch(error => {
        console.error(`${LOG_PREFIX} failed to save the sing-along setting`, error);
        showStatus("Could not save that change.");
        singAlongToggle.setChecked(!next);
      });
    }
  );

  const autoSeparateToggle = createToggle(
    "Start separating automatically",
    "Begin separation as soon as a track is captured, instead of waiting for a tap.",
    settings.autoSeparateEnabled,
    next => {
      saveSettingsFrom(chrome.storage.sync, { autoSeparateEnabled: next }).catch(error => {
        console.error(`${LOG_PREFIX} failed to save the auto-separate setting`, error);
        showStatus("Could not save that change.");
        autoSeparateToggle.setChecked(!next);
      });
    }
  );

  const budgetSlider = createBudgetSlider(CACHE_BUDGET_PRESETS_BYTES, settings.cacheBudgetBytes, bytes => {
    saveSettingsFrom(chrome.storage.sync, { cacheBudgetBytes: bytes })
      .then(() => refreshCacheStatus())
      .catch(error => {
        console.error(`${LOG_PREFIX} failed to save the cache budget`, error);
        showStatus("Could not save that change.");
      });
  });

  const stemRow = createCacheRow("Cached vocals", () => {
    clearStemCache();
  });
  const modelRow = createCacheRow("Separation model", () => {
    clearModelCache();
  });

  root.append(header, singAlongToggle.row, autoSeparateToggle.row, budgetSlider.row, stemRow.row, modelRow.row, status);
  document.body.append(root);

  async function refreshCacheStatus(): Promise<void> {
    const command: GetCacheStatusCommand = { type: "blk-get-cache-status" };
    try {
      const response = await chrome.runtime.sendMessage(command);
      if (!isCacheStatusMessage(response)) throw new Error("unexpected response shape");

      stemRow.setReadout(`${formatBytes(response.stemCacheBytes)} used`);
      stemRow.setClearDisabled(response.stemCacheBytes === 0);

      modelRow.setReadout(
        response.modelCached ? `Downloaded (${formatBytes(response.modelCacheBytes)})` : "Not downloaded"
      );
      modelRow.setClearDisabled(!response.modelCached);
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to read cache status`, error);
      stemRow.setReadout("Could not read cache size.");
      modelRow.setReadout("Could not read cache size.");
    }
  }

  async function clearStemCache(): Promise<void> {
    stemRow.setClearDisabled(true);
    const command: ClearStemCacheCommand = { type: "blk-clear-stem-cache" };
    try {
      const response = await chrome.runtime.sendMessage(command);
      if (!isClearCacheResultMessage(response) || !response.ok) {
        throw new Error(
          isClearCacheResultMessage(response) ? response.reason ?? "clear failed" : "unexpected response shape"
        );
      }
      showStatus("Cached vocals cleared.");
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to clear the stem cache`, error);
      showStatus("Could not clear the vocal cache.");
    } finally {
      await refreshCacheStatus();
    }
  }

  async function clearModelCache(): Promise<void> {
    modelRow.setClearDisabled(true);
    const command: ClearModelCacheCommand = { type: "blk-clear-model-cache" };
    try {
      const response = await chrome.runtime.sendMessage(command);
      if (!isClearCacheResultMessage(response) || !response.ok) {
        throw new Error(
          isClearCacheResultMessage(response) ? response.reason ?? "clear failed" : "unexpected response shape"
        );
      }
      showStatus("Separation model cleared.");
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to clear the model cache`, error);
      showStatus("Could not clear the separation model.");
    } finally {
      await refreshCacheStatus();
    }
  }

  await refreshCacheStatus();
}

main().catch(error => {
  console.error(`${LOG_PREFIX} failed to initialize the popup`, error);
});

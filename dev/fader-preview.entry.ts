// Standalone visual harness for the sing-along fader (Phase 8). Renders the
// real src/ui modules with no extension APIs and no chrome.* calls, so it
// can be opened directly or served statically and screenshotted. All of the
// page chrome (dock pill, player bar stand-in, captions) lives as plain
// static markup in fader-preview.html; this script only instantiates the
// real control and the real mount observer into it.

import { createFaderControl } from "@/ui/fader";
import type { GlyphKind } from "@/ui/fader-geometry";
import { createFilledGlyphSvg, createGlyphMaskUrl } from "@/ui/fader-icons";
import { attachFaderMount } from "@/ui/mount";
import { createTooltip } from "@/ui/tooltip";
import type { Tooltip } from "@/ui/tooltip";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`dev/fader-preview: missing #${id}`);
  return el as T;
}

function log(source: string, mixLevel: number): void {
  const out = document.getElementById("event-log");
  if (!out) return;
  const line = document.createElement("div");
  line.textContent = `${source}: mixLevel=${mixLevel.toFixed(2)}`;
  out.prepend(line);
  while (out.childNodes.length > 6) out.lastChild?.remove();
}

// -- 1: dock-hosted control, 2: bar-hosted control ----------------------------

const dockControl = createFaderControl({ host: "dock", onChange: mixLevel => log("dock", mixLevel) });
byId<HTMLDivElement>("dock-controls-static").appendChild(dockControl.button);

const barControl = createFaderControl({ host: "bar", onChange: mixLevel => log("bar", mixLevel) });
byId<HTMLSpanElement>("bar-slot-static").appendChild(barControl.button);

// -- 3: static glyph meter, exercising the SVG construction directly --------

function buildMeterPill(kind: GlyphKind, fraction: number, caption: string): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "cell";

  const button = document.createElement("button");
  button.className = "blyrics-sing preview-static-glyph";
  if (fraction !== 0) button.classList.add("blyrics-sing--active");
  const glyph = document.createElement("span");
  glyph.className = "blyrics-sing__glyph blyrics-sing__glyph--on";
  glyph.appendChild(createFilledGlyphSvg(kind, fraction));
  button.appendChild(glyph);

  const captionEl = document.createElement("div");
  captionEl.className = "caption";
  captionEl.textContent = caption;

  cell.append(button, captionEl);
  return cell;
}

function buildUnavailablePill(): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "cell";

  const button = document.createElement("button");
  button.className = "blyrics-sing preview-static-glyph preview-unavailable";
  button.title = "Sing-along needs a stereo track";
  const glyph = document.createElement("span");
  glyph.className = "blyrics-sing__glyph blyrics-sing__glyph--on";
  glyph.appendChild(createFilledGlyphSvg("mic", 0));
  button.appendChild(glyph);

  const captionEl = document.createElement("div");
  captionEl.className = "caption";
  captionEl.textContent = "Mono master. Tooltip carries the reason.";

  cell.append(button, captionEl);
  return cell;
}

byId<HTMLDivElement>("meter").append(
  buildMeterPill("mic", 0, "Original. Empty mic, no pill, off."),
  buildMeterPill("note", 0.25, "Vocals down a quarter."),
  buildMeterPill("note", 0.5, "Vocals down by half."),
  buildMeterPill("note", 0.75, "Vocals mostly out."),
  buildMeterPill("note", 1, "Karaoke. Note heads solid."),
  buildUnavailablePill()
);

// -- 4: park mode, proposed ---------------------------------------------------

type ParkState = "idle" | "busy" | "busyArmed" | "engaged" | "failed";

function buildParkPill(state: ParkState, armedTakesPill: boolean, caption: string): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "cell";

  const button = document.createElement("button");
  button.className = "blyrics-sing blyrics-dock__control preview-static-glyph";
  const armed = state === "busyArmed";
  const accented = state === "engaged" || (armed && armedTakesPill);
  if (accented) button.classList.add("blyrics-sing--active", "blyrics-dock__control--active");
  if (state === "failed") button.classList.add("preview-unavailable");

  const glyph = document.createElement("span");
  glyph.className = "blyrics-sing__glyph blyrics-sing__glyph--on";

  if (state === "busy" || state === "busyArmed") {
    glyph.classList.add("blyrics-sing__glyph--busy");
    const inner = document.createElement("span");
    inner.style.setProperty("--glyph", createGlyphMaskUrl(armed ? "note" : "mic"));
    glyph.appendChild(inner);
  } else {
    glyph.appendChild(createFilledGlyphSvg(state === "engaged" ? "note" : "mic", state === "engaged" ? 1 : 0));
  }

  button.appendChild(glyph);

  const captionEl = document.createElement("div");
  captionEl.className = "caption";
  captionEl.textContent = caption;

  cell.append(button, captionEl);
  return cell;
}

const PARK_ROW: Array<[ParkState, string]> = [
  ["idle", "Ready. Empty mic, clickable."],
  ["busy", "Separating. Shimmering mic, still clickable."],
  ["busyArmed", "Armed mid-separation. Shimmering note."],
  ["engaged", "Stems landed, the armed level applied itself."],
  ["failed", "Failed. Dimmed, reason in the tooltip."],
];

for (const [id, armedTakesPill] of [
  ["park-a", true],
  ["park-b", false],
] as Array<[string, boolean]>) {
  byId<HTMLDivElement>(id).append(...PARK_ROW.map(([state, caption]) => buildParkPill(state, armedTakesPill, caption)));
}

const WORDINGS: Array<[string, string, string]> = [
  ["W1", "Separating vocals", "Karaoke starts when this finishes"],
  ["W2", "Separating vocals", "Vocals drop as soon as it is ready"],
];

const wording = byId<HTMLDivElement>("wording");
for (const [name, unarmed, armedText] of WORDINGS) {
  const block = document.createElement("div");
  block.style.cssText = "margin-bottom:18px";
  const label = document.createElement("div");
  label.className = "caption";
  label.style.cssText = "max-width:none;margin:0 0 8px";
  label.textContent = name;
  const before = document.createElement("div");
  before.className = "blyrics-mix-tip is-open";
  before.style.cssText = "position:static;display:inline-flex;margin-right:12px";
  before.textContent = `${unarmed} 47%`;
  const after = document.createElement("div");
  after.className = "blyrics-mix-tip is-open";
  after.style.cssText = "position:static;display:inline-flex";
  after.textContent = `${armedText} 47%`;
  block.append(label, before, after);
  wording.appendChild(block);
}

// -- 5: tooltip against an open card ------------------------------------------

function buildTooltipDemo(slotId: string, suppressWhileOpen: boolean): void {
  let tooltip: Tooltip | undefined;
  const control = createFaderControl({
    host: "dock",
    onChange: mixLevel => log(slotId, mixLevel),
    onOpenChange: open => {
      if (suppressWhileOpen) tooltip?.setSuppressed(open);
    },
  });
  byId<HTMLDivElement>(slotId).appendChild(control.button);
  tooltip = createTooltip(control.button);
  tooltip.setContent({ label: "Click to remove vocals, hold to set the level", percent: null });
}

buildTooltipDemo("tip-before", false);
buildTooltipDemo("tip-after", true);

// -- 6: live migration, exercising the real attachFaderMount -----------------
// The dock and player-bar stand-ins it targets are the static markup with
// id="live-dock-controls" and the real ytmusic-player-bar/yt-icon-button
// tag names in fader-preview.html, so this exercises the real selectors.

// Starts sized for the dock, matching the real integration pattern where a
// caller checks hasBetterLyrics() before the first mount to avoid handing
// createFaderControl the wrong initial glyph size.
const liveControl = createFaderControl({ host: "dock", onChange: mixLevel => log("live", mixLevel) });
const liveStage = byId<HTMLDivElement>("stage-live");
const mountHandle = attachFaderMount(
  { button: liveControl.button, setHost: liveControl.setHost },
  { observeRoot: liveStage }
);

const mountState = byId<HTMLSpanElement>("mount-state");
function refreshMountState(): void {
  mountState.textContent = `mounted: ${liveControl.getHost()}`;
}
new MutationObserver(refreshMountState).observe(liveStage, { childList: true, subtree: true });
refreshMountState();

byId<HTMLButtonElement>("toggle-dock").addEventListener("click", () => {
  const dock = document.getElementById("live-dock");
  const anchor = byId<HTMLDivElement>("live-dock-anchor");
  if (dock?.isConnected) dock.remove();
  else if (dock) anchor.prepend(dock);
});
byId<HTMLButtonElement>("rerender").addEventListener("click", () => {
  const dock = document.getElementById("live-dock");
  const anchor = byId<HTMLDivElement>("live-dock-anchor");
  if (!dock?.isConnected) return;
  dock.remove();
  anchor.prepend(dock); // same frame: exactly what a re-render looks like
});
byId<HTMLButtonElement>("slow-rerender").addEventListener("click", () => {
  const dock = document.getElementById("live-dock");
  const anchor = byId<HTMLDivElement>("live-dock-anchor");
  if (!dock?.isConnected) return;
  dock.remove();
  setTimeout(() => anchor.prepend(dock), 150);
});
byId<HTMLButtonElement>("steal").addEventListener("click", () => {
  liveControl.button.remove();
});

window.addEventListener("beforeunload", () => mountHandle.disconnect());

// Ported from createSingAlong() in docs/mocks/2026-08-07-singalong-mounts.html
// (better-lyrics repo). One control, two hosts: `host` decides the button's
// chrome and which element the card measures its gap from, everything else
// is identical. See docs/plans/2026-08-07-singalong-karaoke.md section 6 for
// the reasoning behind every constant below.
//
// This module emits a mix level (0 to 2, 1 is the original mix untouched)
// through onChange and nothing else. It never touches audio.

import {
  CARD_GAP_PX,
  HOLD_MS,
  LABEL_EXIT_FALLBACK_MS,
  LABEL_HIDE_MS,
  VIEWPORT_EDGE_PX,
  computeCommit,
  computePaintFrame,
  stepValue,
  valueFromPointerOffset,
} from "@/ui/fader-geometry";
import type { Pole } from "@/ui/fader-geometry";
import { createFilledGlyphSvg, createGlyphMaskUrl, createOutlineIcon } from "@/ui/fader-icons";
import { createSpring } from "@/ui/spring";
import type { Spring, SpringDeps, SpringMode } from "@/ui/spring";

type FaderHost = "dock" | "bar";
type GlyphKind = "mic" | "note";
type GlyphLayerKind = GlyphKind | "busy";

interface CreateFaderControlOptions {
  host?: FaderHost;
  onChange(mixLevel: number): void;
  requestAnimationFrame?: SpringDeps["requestAnimationFrame"];
  prefersReducedMotion?: SpringDeps["prefersReducedMotion"];
}

interface FaderControl {
  button: HTMLButtonElement;
  menu: HTMLDivElement;
  getHost(): FaderHost;
  setHost(next: FaderHost): void;
  destroy(): void;
}

// -- Glyph stack --------------------------------------------------------------
// Mic above centre, instrumental below it, shimmer while a companion works.
// All three stay in the DOM and cross-fade, so scrubbing across the middle
// interrupts cleanly instead of restarting a keyframe.

interface GlyphStack {
  el: HTMLSpanElement;
  show(kind: GlyphLayerKind, fraction: number, busyKind?: GlyphKind): void;
}

function createGlyphStack(size: number): GlyphStack {
  const el = document.createElement("span");
  el.style.position = "absolute";
  el.style.inset = "0";

  const micLayer = document.createElement("span");
  micLayer.className = "blyrics-sing__glyph";
  micLayer.dataset.kind = "mic";

  const noteLayer = document.createElement("span");
  noteLayer.className = "blyrics-sing__glyph";
  noteLayer.dataset.kind = "note";

  const busyLayer = document.createElement("span");
  busyLayer.className = "blyrics-sing__glyph blyrics-sing__glyph--busy";
  const busyInner = document.createElement("span");
  busyLayer.appendChild(busyInner);

  el.append(micLayer, noteLayer, busyLayer);

  const layers: Record<GlyphLayerKind, HTMLElement> = { mic: micLayer, note: noteLayer, busy: busyLayer };
  const shownFraction: Partial<Record<GlyphKind, string>> = {};
  let shownKind: GlyphLayerKind | null = null;

  function show(kind: GlyphLayerKind, fraction: number, busyKind?: GlyphKind): void {
    if (kind === "busy") {
      busyInner.style.setProperty("--glyph", createGlyphMaskUrl(busyKind ?? "mic"));
    } else if (shownFraction[kind] !== String(fraction)) {
      shownFraction[kind] = String(fraction);
      layers[kind].replaceChildren(createFilledGlyphSvg(kind, fraction, size));
    }

    if (shownKind === kind) return;
    shownKind = kind;
    for (const [name, node] of Object.entries(layers)) {
      node.classList.toggle("blyrics-sing__glyph--on", name === kind);
    }
  }

  return { el, show };
}

// -- Pole buttons and track ----------------------------------------------------

interface PoleButton {
  button: HTMLButtonElement;
  pole: Pole;
}

function createPoleButton(pole: Pole): PoleButton {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "blyrics-mix-pole";
  button.dataset.pole = String(pole);
  button.setAttribute("aria-label", pole === 1 ? "Vocals up" : "Karaoke");
  button.appendChild(createOutlineIcon(pole === 1 ? "mic" : "note", 15));
  return { button, pole };
}

interface Track {
  track: HTMLDivElement;
  fill: HTMLDivElement;
  thumb: HTMLDivElement;
}

function createTrack(): Track {
  const track = document.createElement("div");
  track.className = "blyrics-mix-track";
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", "Sing-along");
  track.setAttribute("aria-valuemin", "-100");
  track.setAttribute("aria-valuemax", "100");

  const well = document.createElement("div");
  well.className = "blyrics-mix-well";
  const clip = document.createElement("div");
  clip.className = "blyrics-mix-clip";
  const fill = document.createElement("div");
  fill.className = "blyrics-mix-fill";
  const thumb = document.createElement("div");
  thumb.className = "blyrics-mix-thumb";

  clip.append(fill, thumb);
  well.appendChild(clip);
  track.appendChild(well);

  return { track, fill, thumb };
}

// -- The control ---------------------------------------------------------------

function createFaderControl(options: CreateFaderControlOptions): FaderControl {
  let host: FaderHost = options.host ?? "dock";
  const requestFrame: SpringDeps["requestAnimationFrame"] =
    options.requestAnimationFrame ?? ((callback: (time: number) => void) => window.requestAnimationFrame(callback));
  const prefersReducedMotion: SpringDeps["prefersReducedMotion"] =
    options.prefersReducedMotion ?? (() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const button = document.createElement("button");
  button.type = "button";
  button.className = host === "bar" ? "blyrics-sing blyrics-sing--bar" : "blyrics-sing";
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Sing-along");

  const stack = createGlyphStack(host === "bar" ? 20 : 16);
  button.appendChild(stack.el);

  const menu = document.createElement("div");
  menu.className = "blyrics-mix";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Sing-along level");

  const poleUp = createPoleButton(1);
  const { track, fill, thumb } = createTrack();
  const poleDown = createPoleButton(-1);
  const readout = document.createElement("div");
  readout.className = "blyrics-mix-readout";

  menu.append(poleUp.button, track, poleDown.button, readout);
  document.body.appendChild(menu);

  let v = 0;

  // -- Placement --------------------------------------------------------------
  // In the dock the gap is measured off the pill, because the button sits
  // inside its 8px padding. In the bar the button is the outermost thing, so
  // it measures off itself.
  function anchorRect(): DOMRect {
    const pill = button.closest(".blyrics-dock__inner");
    return (pill ?? button).getBoundingClientRect();
  }

  function opensDown(): boolean {
    if (host === "bar") return false;
    const dock = button.closest<HTMLElement>(".blyrics-dock");
    return (dock?.dataset.position ?? "").startsWith("top");
  }

  function place(): void {
    const rect = button.getBoundingClientRect();
    const anchor = anchorRect();
    const down = opensDown();
    const centred = rect.left + rect.width / 2 - menu.offsetWidth / 2;
    const maxLeft = window.innerWidth - menu.offsetWidth - VIEWPORT_EDGE_PX;
    menu.style.left = `${Math.min(Math.max(VIEWPORT_EDGE_PX, centred), Math.max(VIEWPORT_EDGE_PX, maxLeft))}px`;
    menu.style.top = down ? `${anchor.bottom + CARD_GAP_PX}px` : "";
    menu.style.bottom = down ? "" : `${window.innerHeight - anchor.top + CARD_GAP_PX}px`;
    menu.classList.toggle("blyrics-mix--down", down);
    menu.classList.toggle("blyrics-mix--up", !down);
  }

  // -- Paint --------------------------------------------------------------------

  const paint: Spring = createSpring(
    x => {
      const frame = computePaintFrame(x);
      thumb.style.top = `${frame.thumbCenterPercent}%`;
      fill.style.setProperty("--fill-dir", frame.shown >= 0 ? "to top" : "to bottom");
      fill.style.top = `${frame.fillTopPercent}%`;
      fill.style.height = `${frame.fillHeightPercent}%`;
      fill.style.borderRadius = frame.fillBorderRadius;
      thumb.style.setProperty("--shadow-y", `${frame.shadowYPx.toFixed(2)}px`);
      stack.show(frame.glyphKind, frame.glyphFraction);
    },
    { requestAnimationFrame: requestFrame, prefersReducedMotion }
  );

  // -- Transient label ------------------------------------------------------------

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let shownWord: string | null = null;

  function flashLabel(text: string): void {
    readout.classList.add("blyrics-mix-readout--visible");
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => readout.classList.remove("blyrics-mix-readout--visible"), LABEL_HIDE_MS);
    if (text === shownWord) return;
    shownWord = text;

    const leaving = readout.querySelector<HTMLElement>(".blyrics-mix-word:not(.blyrics-mix-word--exit)");
    if (leaving) {
      leaving.classList.add("blyrics-mix-word--exit");
      leaving.addEventListener("transitionend", () => leaving.remove(), { once: true });
      setTimeout(() => leaving.remove(), LABEL_EXIT_FALLBACK_MS);
    }

    const entering = document.createElement("span");
    entering.className = "blyrics-mix-word blyrics-mix-word--enter";
    entering.textContent = text;
    readout.appendChild(entering);
    requestFrame(() => requestFrame(() => entering.classList.remove("blyrics-mix-word--enter")));
  }

  // -- Commit -----------------------------------------------------------------

  function commit(mode: SpringMode, announce = true): void {
    const frame = computeCommit(v);
    paint.set(frame.effectiveValue, mode);
    button.classList.toggle("blyrics-sing--active", frame.effectiveValue !== 0);
    track.dataset.rest = String(frame.effectiveValue === 0);
    track.setAttribute("aria-valuenow", String(Math.round(frame.effectiveValue * 100)));
    track.setAttribute("aria-valuetext", frame.label);
    if (announce) flashLabel(frame.label);
    poleUp.button.classList.toggle("blyrics-mix-pole--reached", frame.poleReached[1]);
    poleDown.button.classList.toggle("blyrics-mix-pole--reached", frame.poleReached[-1]);
    options.onChange(frame.mixLevel);
  }

  // -- Open / close -------------------------------------------------------------

  let open = false;

  function setOpen(next: boolean): void {
    open = next;
    if (next) place();
    menu.classList.toggle("blyrics-mix--open", next);
    button.setAttribute("aria-expanded", String(next));
    if (next) track.focus();
  }

  function onResize(): void {
    if (open) place();
  }
  function onScroll(): void {
    if (open) place();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, { passive: true });

  // Tap toggles Karaoke on and off. Hold or double-click opens the fader.
  // The hold timer marks itself handled so releasing after a hold does not
  // also toggle.
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdHandled = false;

  function clearHold(): void {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
  }

  button.addEventListener("pointerdown", () => {
    holdHandled = false;
    holdTimer = setTimeout(() => {
      holdHandled = true;
      setOpen(true);
    }, HOLD_MS);
  });
  button.addEventListener("pointerup", clearHold);
  button.addEventListener("pointerleave", clearHold);
  button.addEventListener("click", () => {
    if (holdHandled) return;
    v = v === 0 ? -1 : 0;
    commit("settle");
  });
  button.addEventListener("dblclick", () => setOpen(true));
  button.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  });

  function onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (target && !menu.contains(target) && !button.contains(target)) setOpen(false);
  }
  document.addEventListener("pointerdown", onDocumentPointerDown);

  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      setOpen(false);
      button.focus();
    }
  }
  menu.addEventListener("keydown", onMenuKeydown);

  // -- Track: drag, double-click reset, keys -------------------------------------

  track.addEventListener("pointerdown", event => {
    track.setPointerCapture(event.pointerId);

    function apply(pointerEvent: PointerEvent): void {
      const rect = track.getBoundingClientRect();
      v = valueFromPointerOffset(pointerEvent.clientY, rect.top, rect.height);
      commit("drag");
    }
    apply(event);

    function onPointerMove(pointerEvent: PointerEvent): void {
      apply(pointerEvent);
    }
    function onPointerUp(): void {
      commit("settle");
      track.removeEventListener("pointermove", onPointerMove);
      track.removeEventListener("pointerup", onPointerUp);
    }
    track.addEventListener("pointermove", onPointerMove);
    track.addEventListener("pointerup", onPointerUp);
  });

  track.addEventListener("dblclick", () => {
    v = 0;
    commit("settle");
  });

  track.addEventListener("keydown", event => {
    const big = event.shiftKey;
    if (event.key === "ArrowUp") v = stepValue(v, 1, big);
    else if (event.key === "ArrowDown") v = stepValue(v, -1, big);
    else if (event.key === "Home") v = 0;
    else return;
    event.preventDefault();
    commit("settle");
  });

  for (const pole of [poleUp, poleDown]) {
    pole.button.addEventListener("click", () => {
      v = v === pole.pole ? 0 : pole.pole;
      commit("settle");
    });
  }

  commit("settle", false);
  paint.jump(0);

  function setHost(next: FaderHost): void {
    // The control is stateless UI over a single value: moving it between
    // hosts is a reparent and a class swap, nothing is torn down or re-read.
    host = next;
    button.classList.toggle("blyrics-sing--bar", next === "bar");
  }

  function destroy(): void {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    clearHold();
    if (hideTimer !== null) clearTimeout(hideTimer);
    menu.remove();
  }

  return { button, menu, getHost: () => host, setHost, destroy };
}

export { createFaderControl };
export type { FaderHost, CreateFaderControlOptions, FaderControl };

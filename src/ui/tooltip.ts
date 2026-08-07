import { computeCardPosition } from "@/ui/fader-position";

// -- Hover card --------------------------------------------------------------
//
// Replaces the native title, which never appeared: the states worth explaining
// are exactly the ones where the control is unavailable, and a button carrying
// the disabled attribute fires no pointer events at all. The control now marks
// itself aria-disabled instead, so it still reports as unavailable and can still
// be hovered.
//
// Content changes while the pointer is on it, so a step change rolls the line
// out and the next one in, while a percentage that moves several times a second
// swaps only its digits.

const TOOLTIP_CLASS = "blyrics-mix-tip";
const LINE_CLASS = "blyrics-mix-tip__line";
const PERCENT_CLASS = "blyrics-mix-tip__pct";

// Long enough that brushing past the control does not flash the card, short
// enough that a deliberate hover feels immediate.
const OPEN_DELAY_MS = 120;
// The safety window: leaving and returning inside it never closes the card.
const CLOSE_DELAY_MS = 160;
const ROLL_MS = 320;

interface TooltipContent {
  label: string;
  percent: number | null;
}

interface Tooltip {
  setContent(content: TooltipContent | null): void;
  destroy(): void;
}

function sameStep(a: TooltipContent | null, b: TooltipContent): boolean {
  return a !== null && a.label === b.label;
}

function percentText(percent: number): string {
  return `${Math.round(Math.min(1, Math.max(0, percent)) * 100)}%`;
}

function buildLine(content: TooltipContent): HTMLSpanElement {
  const line = document.createElement("span");
  line.className = `${LINE_CLASS} is-entering`;
  line.textContent = content.percent === null ? `${content.label}…` : `${content.label}… `;
  if (content.percent !== null) {
    const percent = document.createElement("span");
    percent.className = PERCENT_CLASS;
    percent.textContent = percentText(content.percent);
    line.appendChild(percent);
  }
  // Entering and leaving carry the same specificity, so a line still marked as
  // entering re-runs that animation instead of leaving, and the two overlap.
  line.addEventListener("animationend", () => line.classList.remove("is-entering"), { once: true });
  return line;
}

function createTooltip(trigger: HTMLElement): Tooltip {
  const card = document.createElement("div");
  card.className = TOOLTIP_CLASS;
  card.setAttribute("role", "tooltip");
  const stack = document.createElement("span");
  stack.className = "blyrics-mix-tip__stack";
  card.appendChild(stack);

  // Width does not transition from auto, so the next label is measured here and
  // written to the card as pixels before the swap starts.
  const ruler = document.createElement("span");
  ruler.className = "blyrics-mix-tip__ruler";
  card.appendChild(ruler);

  document.body.appendChild(card);

  let content: TooltipContent | null = null;
  let open = false;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers(): void {
    if (openTimer !== null) clearTimeout(openTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  }

  function place(): void {
    const triggerRect = trigger.getBoundingClientRect();
    const dock = trigger.closest<HTMLElement>("[data-position]");
    const position = computeCardPosition(
      { left: triggerRect.left, width: triggerRect.width },
      { top: triggerRect.top, bottom: triggerRect.bottom },
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      dock?.dataset.position ?? null
    );
    card.style.left = `${position.left}px`;
    card.style.top = position.top;
    card.style.bottom = position.bottom;
  }

  function show(): void {
    if (open || !content) return;
    open = true;
    card.classList.add("is-open");
    place();
  }

  function hide(): void {
    open = false;
    card.classList.remove("is-open");
  }

  function setContent(next: TooltipContent | null): void {
    if (!next) {
      content = null;
      hide();
      return;
    }

    const previous = stack.querySelector<HTMLSpanElement>(`.${LINE_CLASS}:not(.is-leaving)`);

    // The same step with a new number: the line stays put and only its digits
    // change, or the card strobes for the length of the separation.
    if (previous && sameStep(content, next) && next.percent !== null) {
      const percent = previous.querySelector(`.${PERCENT_CLASS}`);
      if (percent) {
        percent.textContent = percentText(next.percent);
        content = next;
        return;
      }
    }

    ruler.textContent = next.percent === null ? `${next.label}…` : `${next.label}… ${percentText(next.percent)}`;
    card.style.width = `${ruler.offsetWidth}px`;

    if (previous) {
      previous.classList.remove("is-entering");
      previous.classList.add("is-leaving");
      previous.addEventListener("animationend", () => previous.remove(), { once: true });
      // Without this the line survives whenever the animation does not run, and
      // the overlap is permanent rather than momentary.
      setTimeout(() => previous.remove(), ROLL_MS + 200);
    }
    stack.appendChild(buildLine(next));

    content = next;
    if (open) place();
  }

  function onEnter(): void {
    clearTimers();
    openTimer = setTimeout(show, OPEN_DELAY_MS);
  }

  function onLeave(): void {
    clearTimers();
    closeTimer = setTimeout(hide, CLOSE_DELAY_MS);
  }

  trigger.addEventListener("pointerenter", onEnter);
  trigger.addEventListener("pointerleave", onLeave);
  trigger.addEventListener("focus", show);
  trigger.addEventListener("blur", hide);

  function destroy(): void {
    clearTimers();
    trigger.removeEventListener("pointerenter", onEnter);
    trigger.removeEventListener("pointerleave", onLeave);
    trigger.removeEventListener("focus", show);
    trigger.removeEventListener("blur", hide);
    card.remove();
  }

  return { setContent, destroy };
}

export { createTooltip, TOOLTIP_CLASS };
export type { Tooltip, TooltipContent };

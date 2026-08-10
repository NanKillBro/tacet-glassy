// -- Non-native select ----------------------------------------------------------

import { resolveOptionIndex, selectKeyAction, wrapIndex } from "@/settings/select-state";

const SVG_NS = "http://www.w3.org/2000/svg";

const CHEVRON_PATH = "M3 4.5 L6 7.5 L9 4.5";
const CHECK_PATH = "M2.5 6.5 L5 9 L9.5 3.5";

interface SelectOption<Value extends string> {
  value: Value;
  label: string;
  note?: string;
}

interface Select<Value extends string> {
  element: HTMLElement;
  setValue(value: Value): void;
  close(): void;
}

function createIcon(path: string, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  const node = document.createElementNS(SVG_NS, "path");
  node.setAttribute("d", path);
  svg.append(node);
  return svg;
}

function createSelect<Value extends string>(
  options: readonly SelectOption<Value>[],
  initialValue: Value,
  onChange: (next: Value) => void,
  labelledBy?: string
): Select<Value> {
  const element = document.createElement("div");
  element.className = "blk-select";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "blk-select__trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  if (labelledBy) trigger.setAttribute("aria-labelledby", labelledBy);

  const triggerLabel = document.createElement("span");
  trigger.append(triggerLabel, createIcon(CHEVRON_PATH, "blk-select__chevron"));

  const panel = document.createElement("div");
  panel.className = "blk-select__panel";
  panel.setAttribute("role", "listbox");
  if (labelledBy) panel.setAttribute("aria-labelledby", labelledBy);
  panel.hidden = true;

  let current = initialValue;

  const buttons = options.map(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "blk-select__option";
    button.setAttribute("role", "option");
    button.dataset.value = option.value;

    const label = document.createElement("span");
    label.className = "blk-select__option-label";
    label.textContent = option.label;
    button.append(label);

    if (option.note !== undefined) {
      const note = document.createElement("span");
      note.className = "blk-select__option-note";
      note.textContent = option.note;
      button.append(note);
    }

    button.append(createIcon(CHECK_PATH, "blk-select__check"));
    button.addEventListener("click", () => {
      close();
      trigger.focus();
      if (option.value === current) return;
      render(option.value);
      onChange(option.value);
    });
    panel.append(button);
    return button;
  });

  function render(value: Value): void {
    current = value;
    const selectedIndex = resolveOptionIndex(
      options.map(option => option.value),
      value
    );
    triggerLabel.textContent = options[selectedIndex]?.label ?? value;
    buttons.forEach((button, index) => {
      button.setAttribute("aria-selected", String(index === selectedIndex));
    });
  }

  function isOpen(): boolean {
    return !panel.hidden;
  }

  function open(): void {
    if (isOpen()) return;
    panel.hidden = false;
    element.classList.add("blk-select--open");
    trigger.setAttribute("aria-expanded", "true");
    const selected = buttons.find(button => button.getAttribute("aria-selected") === "true");
    (selected ?? buttons[0])?.focus();
  }

  function close(): void {
    if (!isOpen()) return;
    panel.hidden = true;
    element.classList.remove("blk-select--open");
    trigger.setAttribute("aria-expanded", "false");
  }

  function moveFocus(step: number): void {
    const from = buttons.findIndex(button => button === document.activeElement);
    const next = wrapIndex(buttons.length, from, step);
    if (next !== -1) buttons[next].focus();
  }

  trigger.addEventListener("click", () => {
    if (isOpen()) close();
    else open();
  });

  element.addEventListener("keydown", event => {
    const action = selectKeyAction(event.key, isOpen());
    if (action === null) return;
    event.preventDefault();

    if (action === "open") open();
    else if (action === "close") {
      close();
      trigger.focus();
    } else if (action === "focus-next") moveFocus(1);
    else if (action === "focus-previous") moveFocus(-1);
    else if (action === "focus-first") buttons[0]?.focus();
    else buttons[buttons.length - 1]?.focus();
  });

  panel.addEventListener("mousedown", event => event.preventDefault());

  element.addEventListener("focusout", event => {
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Node && element.contains(next)) return;
    queueMicrotask(() => {
      if (!element.contains(document.activeElement)) close();
    });
  });

  render(initialValue);
  element.append(trigger, panel);
  return { element, setValue: render, close };
}

export { createSelect };
export type { Select, SelectOption };

// -- Select decisions ------------------------------------------------------------

type SelectKeyAction = "open" | "close" | "focus-next" | "focus-previous" | "focus-first" | "focus-last";

function resolveOptionIndex(values: readonly string[], value: string): number {
  const index = values.indexOf(value);
  return index === -1 ? 0 : index;
}

function wrapIndex(count: number, from: number, step: number): number {
  if (count <= 0) return -1;
  const start = from < 0 ? 0 : from;
  return (((start + step) % count) + count) % count;
}

function selectKeyAction(key: string, isOpen: boolean): SelectKeyAction | null {
  if (key === "Escape") return isOpen ? "close" : null;
  if (key === "ArrowDown") return isOpen ? "focus-next" : "open";
  if (key === "ArrowUp") return isOpen ? "focus-previous" : "open";
  if (key === "Home") return isOpen ? "focus-first" : null;
  if (key === "End") return isOpen ? "focus-last" : null;
  return null;
}

export { resolveOptionIndex, selectKeyAction, wrapIndex };
export type { SelectKeyAction };

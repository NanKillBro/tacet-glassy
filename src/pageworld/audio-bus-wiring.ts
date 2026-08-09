interface BusWiring {
  context: unknown;
  source: unknown;
  element: unknown;
}

function sourceBelongsToBus({ context, source, element }: BusWiring): boolean {
  if (typeof source !== "object" || source === null) return false;
  const { context: sourceContext, mediaElement } = source as {
    context?: unknown;
    mediaElement?: unknown;
  };
  if (sourceContext === undefined || mediaElement === undefined) return false;
  return sourceContext === context && mediaElement === element;
}

export { sourceBelongsToBus };
export type { BusWiring };

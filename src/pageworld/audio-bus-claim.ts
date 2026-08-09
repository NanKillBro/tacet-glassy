type AudioBusClaim = "create" | "reuse" | "incompatible";

function decideAudioBusClaim(
  existing: unknown,
  expectedVersion: number,
  isCompatibleShape: (value: unknown) => value is { version: number }
): AudioBusClaim {
  if (existing === undefined || existing === null) return "create";
  if (!isCompatibleShape(existing)) return "incompatible";
  return existing.version === expectedVersion ? "reuse" : "incompatible";
}

export { decideAudioBusClaim };
export type { AudioBusClaim };

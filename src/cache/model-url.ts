// Resolves the htdemucs model URL from PLASMO_PUBLIC_MODEL_BASE_URL. Plasmo
// substitutes this at build time in files it bundles (src/background.ts),
// unlike workers/, which is compiled by plain tsc and never sees process.env.
// Simplified from composer's model-registry.ts: a single model, no variants.

const MODEL_FILENAME = "htdemucs_fp16.onnx";

function getModelUrl(): string | null {
  const raw = process.env.PLASMO_PUBLIC_MODEL_BASE_URL;
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.length > 0 ? `${trimmed}/${MODEL_FILENAME}` : null;
}

export { getModelUrl, MODEL_FILENAME };

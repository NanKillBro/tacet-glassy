const MODEL_FILENAME = "htdemucs_fp32.v1.onnx";

const MODEL_SHA256 = "47a8c4169cbc08550c7ac1aa6e525b480ccd091efdbd21ffbb88f5f60566d3bd";

const DEFAULT_MODEL_BASE_URL = "https://models.betterlyrics.org/tacet";

function getModelUrl(): string {
  const raw = process.env.PLASMO_PUBLIC_MODEL_BASE_URL;
  const trimmed = typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  const base = trimmed.length > 0 ? trimmed : DEFAULT_MODEL_BASE_URL;
  return `${base}/${MODEL_FILENAME}`;
}

export { DEFAULT_MODEL_BASE_URL, getModelUrl, MODEL_FILENAME, MODEL_SHA256 };

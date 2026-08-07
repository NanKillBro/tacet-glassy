// Resolves the htdemucs model URL from PLASMO_PUBLIC_MODEL_BASE_URL. Plasmo
// substitutes this at build time in files it bundles (src/background.ts),
// unlike workers/, which is compiled by plain tsc and never sees process.env.
// Simplified from composer's model-registry.ts: a single model, no variants.

const MODEL_FILENAME = "htdemucs_fp16.onnx";

// Must stay in sync with host_permissions in package.json. Plasmo does not strip
// an unresolved "$VAR/*" host permission when the variable is unset, and Chrome
// then ignores the malformed entry silently, so the fetch fails with no
// diagnostic. A static default keeps the permission and the URL agreeing.
const DEFAULT_MODEL_BASE_URL = "https://models.composer.dacubeking.com";

function getModelUrl(): string {
  const raw = process.env.PLASMO_PUBLIC_MODEL_BASE_URL;
  const trimmed = typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  const base = trimmed.length > 0 ? trimmed : DEFAULT_MODEL_BASE_URL;
  return `${base}/${MODEL_FILENAME}`;
}

export { DEFAULT_MODEL_BASE_URL, getModelUrl, MODEL_FILENAME };

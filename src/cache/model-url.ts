// Resolves the htdemucs model URL from PLASMO_PUBLIC_MODEL_BASE_URL. Plasmo
// substitutes this at build time in files it bundles (src/background.ts),
// unlike workers/, which is compiled by plain tsc and never sees process.env.
// Simplified from composer's model-registry.ts: a single model, no variants.

// fp32, not the smaller fp16 export. Half precision tops out at 65504 and
// htdemucs overflows it: measured against fp16, zero input returned clean
// zeros while any non-zero input returned NaN (19% of the time branch at
// amplitude 1e-3, 100% at amplitude 1.0), identically on the WebGPU and the
// WASM providers. NaN passes every shape check and only becomes visible once
// the Opus encoder has turned it into silence.
// Versioned, so the object can be cached immutably and a rename is the only
// invalidation needed.
const MODEL_FILENAME = "htdemucs_fp32.v1.onnx";

// Verified against the hosted object. A truncated download keeps every tensor
// shape valid and only shows up as garbled audio, the way fp16 did.
const MODEL_SHA256 = "47a8c4169cbc08550c7ac1aa6e525b480ccd091efdbd21ffbb88f5f60566d3bd";

// Must stay in sync with host_permissions in package.json. Plasmo does not strip
// an unresolved "$VAR/*" host permission when the variable is unset, and Chrome
// then ignores the malformed entry silently, so the fetch fails with no
// diagnostic. A static default keeps the permission and the URL agreeing.
const DEFAULT_MODEL_BASE_URL = "https://models.betterlyrics.org/tacet";

function getModelUrl(): string {
  const raw = process.env.PLASMO_PUBLIC_MODEL_BASE_URL;
  const trimmed = typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  const base = trimmed.length > 0 ? trimmed : DEFAULT_MODEL_BASE_URL;
  return `${base}/${MODEL_FILENAME}`;
}

export { DEFAULT_MODEL_BASE_URL, getModelUrl, MODEL_FILENAME, MODEL_SHA256 };

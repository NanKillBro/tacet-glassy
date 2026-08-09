import type { GlyphKind } from "@/ui/fader-geometry";

const SVG_NS = "http://www.w3.org/2000/svg";
const STROKE_WIDTH = 1.75;

const MIC_OUTLINE = "M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v1a7 7 0 0 1-14 0v-1M12 18v4";
const MIC_FILL = "M12 2.875a2.125 2.125 0 0 0-2.125 2.125v6a2.125 2.125 0 0 0 4.25 0V5a2.125 2.125 0 0 0-2.125-2.125Z";
const NOTE_OUTLINE = "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0M21 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0";
const NOTE_FILL =
  "M8.125 18a2.125 2.125 0 1 1-4.25 0a2.125 2.125 0 1 1 4.25 0M20.125 16a2.125 2.125 0 1 1-4.25 0a2.125 2.125 0 1 1 4.25 0";
const TRANSLATE_OUTLINE = "m5 8 6 6m-7 0 6-6 3-3M2 5h12M7 2h1m14 20-5-10-5 10m2-4h6";
const WAVEFORM_OUTLINE = "M2 12h3l3-8 4 16 3-8h5";

const OUTLINE: Record<GlyphKind, string> = { mic: MIC_OUTLINE, note: NOTE_OUTLINE };
const FILL: Record<GlyphKind, string> = { mic: MIC_FILL, note: NOTE_FILL };

const FILL_SPAN: Record<GlyphKind, [number, number]> = {
  mic: [2.875, 10.25],
  note: [13.875, 6.25],
};

let clipIdSequence = 0;

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {}
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element as SVGElementTagNameMap[K];
}

function createIconSvgRoot(size: number, stroke: string): SVGSVGElement {
  return createSvgElement("svg", {
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    "stroke-width": String(STROKE_WIDTH),
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
}

function createIconSvg(pathData: string, size = 16, stroke = "currentColor"): SVGSVGElement {
  const svg = createIconSvgRoot(size, stroke);
  svg.appendChild(createSvgElement("path", { d: pathData }));
  return svg;
}

function createTranslateIcon(size = 16): SVGSVGElement {
  return createIconSvg(TRANSLATE_OUTLINE, size);
}

function createWaveformIcon(size = 16): SVGSVGElement {
  return createIconSvg(WAVEFORM_OUTLINE, size);
}

function createFilledGlyphSvg(kind: GlyphKind, fraction: number, size = 16): SVGSVGElement {
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  const clipId = `blyrics-glyph-clip-${clipIdSequence++}`;
  const [y0, height] = FILL_SPAN[kind];

  const svg = createIconSvgRoot(size, "currentColor");

  const clipRect = createSvgElement("rect", {
    x: "0",
    y: String(y0 + height * (1 - clampedFraction)),
    width: "24",
    height: String(height * clampedFraction),
  });
  const clipPath = createSvgElement("clipPath", { id: clipId });
  clipPath.appendChild(clipRect);
  const defs = createSvgElement("defs");
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  const filledGroup = createSvgElement("g", { "clip-path": `url(#${clipId})`, "fill-opacity": "var(--glyph-o)" });
  filledGroup.appendChild(createSvgElement("path", { d: FILL[kind], fill: "currentColor", stroke: "none" }));
  svg.appendChild(filledGroup);

  const strokeGroup = createSvgElement("g", { "stroke-opacity": "var(--glyph-o)" });
  strokeGroup.appendChild(createSvgElement("path", { d: OUTLINE[kind] }));
  svg.appendChild(strokeGroup);

  return svg;
}

function createGlyphMaskUrl(kind: GlyphKind): string {
  const serialized = new XMLSerializer().serializeToString(createIconSvg(OUTLINE[kind], 24, "white"));
  return `url("data:image/svg+xml,${encodeURIComponent(serialized)}")`;
}

export { createTranslateIcon, createWaveformIcon, createFilledGlyphSvg, createGlyphMaskUrl };

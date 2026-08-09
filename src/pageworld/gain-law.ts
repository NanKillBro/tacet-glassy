const MIN_MIX_LEVEL = 0;
const MAX_MIX_LEVEL = 2;
const INSTRUMENTAL_GAIN = 1;

interface StemGains {
  vocalsGain: number;
  instrumentalGain: number;
}

function clampMixLevel(mixLevel: number): number {
  if (Number.isNaN(mixLevel)) {
    throw new Error(`gain-law: mixLevel must be a number, got NaN`);
  }
  return Math.max(MIN_MIX_LEVEL, Math.min(MAX_MIX_LEVEL, mixLevel));
}

function gainsForMixLevel(mixLevel: number): StemGains {
  return { vocalsGain: clampMixLevel(mixLevel), instrumentalGain: INSTRUMENTAL_GAIN };
}

export { MIN_MIX_LEVEL, MAX_MIX_LEVEL, INSTRUMENTAL_GAIN, clampMixLevel, gainsForMixLevel };
export type { StemGains };

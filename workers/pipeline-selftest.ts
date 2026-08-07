import { decodeOpusToPcm, encodePcmToOpus } from "../src/cache/opus-codec.js";
import { createRegionAccumulator } from "../src/orchestrator/region-accumulator.js";
import { TARGET_SAMPLE_RATE } from "../src/separation/audio-codec.js";
import type { SeparationHost } from "./separation-host.js";

// -- Synthetic end-to-end bisect ---------------------------------------------
//
// Feeds a known non-silent signal through the real separation path, skipping
// only capture and decode. The whole point is to answer one question the
// production run cannot: does audio survive the worker round trip, the
// stitcher, the accumulator and the Opus codec at all?
//
// The signal is a pair of sines, which htdemucs has no reason to hear as a
// voice, so vocals may legitimately come back near silent. instrumental is
// derived as original - vocals, so it must come back close to the input.
// An instrumental of ~0 means the original never reached the worker, which
// is a plumbing failure rather than a model result.

const TEST_SECONDS = 24;
const TEST_AMPLITUDE = 0.3;

function rms(channel: Float32Array | undefined): number {
  if (!channel || channel.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / channel.length);
}

function buildTestSignal(): { channels: Float32Array[]; totalFrames: number } {
  const totalFrames = TEST_SECONDS * TARGET_SAMPLE_RATE;
  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    const t = i / TARGET_SAMPLE_RATE;
    left[i] = TEST_AMPLITUDE * Math.sin(2 * Math.PI * 220 * t);
    right[i] = TEST_AMPLITUDE * Math.sin(2 * Math.PI * 330 * t);
  }
  return { channels: [left, right], totalFrames };
}

interface SelfTestReport {
  inputRms: number;
  regionsReceived: number;
  firstRegionVocalsRms: number;
  firstRegionInstrumentalRms: number;
  accumulatedVocalsRms: number;
  accumulatedInstrumentalRms: number;
  roundTripInstrumentalRms: number;
  verdict: string;
}

function judge(report: Omit<SelfTestReport, "verdict">): string {
  if (report.regionsReceived === 0) {
    return "FAILED: the worker never emitted a region, so both stems stayed zero-filled";
  }
  if (Number.isNaN(report.firstRegionVocalsRms) || Number.isNaN(report.firstRegionInstrumentalRms)) {
    return "FAILED: regions contain NaN, which the Opus encoder turns into silence";
  }
  if (report.firstRegionInstrumentalRms < 1e-4) {
    return "FAILED: regions arrive silent, so the original audio never reached the worker";
  }
  if (report.accumulatedInstrumentalRms < 1e-4) {
    return "FAILED: regions carry audio but the accumulator is silent";
  }
  if (report.roundTripInstrumentalRms < 1e-4) {
    return "FAILED: the accumulator holds audio but the Opus round trip is silent";
  }
  return "OK: signal survives the worker, the stitcher, the accumulator and the codec";
}

async function runPipelineSelfTest(host: SeparationHost, modelUrl: string, forceWasm = false): Promise<SelfTestReport> {
  const { channels, totalFrames } = buildTestSignal();
  const inputRms = rms(channels[0]);
  console.log(`[BLK-SELFTEST] input: frames=${totalFrames}, rms=${inputRms.toExponential(3)}, forceWasm=${forceWasm}`);

  await host.init({ modelUrl, forceWasm });

  const accumulator = createRegionAccumulator(totalFrames, channels.length);
  let regionsReceived = 0;
  let firstRegionVocalsRms = 0;
  let firstRegionInstrumentalRms = 0;

  await host.process({
    channels,
    totalFrames,
    onRegion: region => {
      if (regionsReceived === 0) {
        firstRegionVocalsRms = rms(region.vocals[0]);
        firstRegionInstrumentalRms = rms(region.instrumental[0]);
      }
      regionsReceived++;
      accumulator.addRegion(region.regionStart, region.vocals, region.instrumental);
    },
  });

  const instrumentalBlob = await encodePcmToOpus(accumulator.instrumental, TARGET_SAMPLE_RATE);
  const roundTrip = await decodeOpusToPcm(instrumentalBlob);

  const measured = {
    inputRms,
    regionsReceived,
    firstRegionVocalsRms,
    firstRegionInstrumentalRms,
    accumulatedVocalsRms: rms(accumulator.vocals[0]),
    accumulatedInstrumentalRms: rms(accumulator.instrumental[0]),
    roundTripInstrumentalRms: rms(roundTrip.channels[0]),
  };
  const report: SelfTestReport = { ...measured, verdict: judge(measured) };
  console.log("[BLK-SELFTEST]", report);
  return report;
}

export { runPipelineSelfTest };
export type { SelfTestReport };

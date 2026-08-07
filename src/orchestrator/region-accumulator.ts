// Assembles the region-by-region output of SeparationHost.process() (see
// workers/separation-host.ts's onRegion callback) into complete
// full-track stem buffers. This project ships batch playback only: nothing
// reads a partial accumulator, everything waits for process() to resolve,
// at which point every region has landed. Progressive read-as-you-go
// playback is a known future seam, deliberately not built here (see
// workers/track-pipeline.ts).

interface RegionAccumulator {
  vocals: Float32Array[];
  instrumental: Float32Array[];
  addRegion(regionStart: number, vocals: Float32Array[], instrumental: Float32Array[]): void;
}

function createRegionAccumulator(totalFrames: number, channelCount: number): RegionAccumulator {
  const vocals = Array.from({ length: channelCount }, () => new Float32Array(totalFrames));
  const instrumental = Array.from({ length: channelCount }, () => new Float32Array(totalFrames));

  function addRegion(regionStart: number, vocalsRegion: Float32Array[], instrumentalRegion: Float32Array[]): void {
    if (vocalsRegion.length !== channelCount || instrumentalRegion.length !== channelCount) {
      throw new Error(
        `region-accumulator: expected ${channelCount} channels, got vocals=${vocalsRegion.length} instrumental=${instrumentalRegion.length}`
      );
    }
    for (let channel = 0; channel < channelCount; channel++) {
      vocals[channel].set(vocalsRegion[channel], regionStart);
      instrumental[channel].set(instrumentalRegion[channel], regionStart);
    }
  }

  return { vocals, instrumental, addRegion };
}

export { createRegionAccumulator };
export type { RegionAccumulator };

// An ISOBMFF (fragmented MP4) init segment leads with a top-level ftyp box:
// a 4-byte big-endian size, then the 4-byte ASCII box type. Media segments
// lead with moof/styp instead. This is a heuristic, not a full box parser,
// but it is enough to tell "here is a fresh initialization" from "here is
// another chunk of the same track" without pulling in a demuxer.

const BOX_TYPE_OFFSET = 4;
const BOX_TYPE_LENGTH = 4;
const FTYP_BOX_TYPE = "ftyp";

function looksLikeInitSegment(bytes: Uint8Array): boolean {
  if (bytes.byteLength < BOX_TYPE_OFFSET + BOX_TYPE_LENGTH) return false;
  const boxTypeBytes = bytes.subarray(BOX_TYPE_OFFSET, BOX_TYPE_OFFSET + BOX_TYPE_LENGTH);
  const boxType = String.fromCharCode(...boxTypeBytes);
  return boxType === FTYP_BOX_TYPE;
}

export { BOX_TYPE_OFFSET, BOX_TYPE_LENGTH, FTYP_BOX_TYPE, looksLikeInitSegment };

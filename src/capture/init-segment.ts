// Tells "here is a fresh initialization" from "here is another chunk of the
// same track", for both containers YouTube serves, without pulling in a
// demuxer.
//
// An ISOBMFF (fragmented MP4) init segment leads with a top-level ftyp box: a
// 4-byte big-endian size, then the 4-byte ASCII box type. Media segments lead
// with moof/styp instead.
//
// WebM is the one that actually matters here, and it was missing: YouTube Music
// serves audio/webm with codecs="opus", so the ftyp test never fired, every
// chunk was tagged as media, and planFirstPlusMedia quietly degenerated into
// plain concatenation. A WebM init segment leads with the EBML header id
// 1A45DFA3; a media segment leads with a Cluster id 1F43B675. Getting this
// wrong is not visible until a mid-stream quality switch splices a second
// header into the bytes and the whole track stops decoding.

const BOX_TYPE_OFFSET = 4;
const BOX_TYPE_LENGTH = 4;
const FTYP_BOX_TYPE = "ftyp";
const EBML_HEADER_ID = [0x1a, 0x45, 0xdf, 0xa3];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.byteLength < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

function looksLikeInitSegment(bytes: Uint8Array): boolean {
  if (startsWith(bytes, EBML_HEADER_ID)) return true;
  if (bytes.byteLength < BOX_TYPE_OFFSET + BOX_TYPE_LENGTH) return false;
  const boxTypeBytes = bytes.subarray(BOX_TYPE_OFFSET, BOX_TYPE_OFFSET + BOX_TYPE_LENGTH);
  const boxType = String.fromCharCode(...boxTypeBytes);
  return boxType === FTYP_BOX_TYPE;
}

export { BOX_TYPE_OFFSET, BOX_TYPE_LENGTH, FTYP_BOX_TYPE, EBML_HEADER_ID, looksLikeInitSegment };

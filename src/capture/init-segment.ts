// Tells a fresh initialization from another chunk of the same stream, for both
// containers YouTube serves. WebM (1A45DFA3 header, 1F43B675 clusters) is the
// one YouTube Music actually uses; fragmented MP4 leads with an ftyp box.
// Missing the WebM case is invisible until a mid-stream quality switch splices
// a second header in and the whole capture stops decoding.

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

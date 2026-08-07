// btoa/atob only accept binary strings (one char code per byte), and
// String.fromCharCode(...bytes) overflows the call stack past a few tens of
// thousands of bytes, so both directions chunk through an intermediate
// binary string in fixed-size blocks. chrome.runtime messaging is JSON-only
// (see src/relay/chunk-transfer.ts), which is what these bytes cross as.

const BINARY_STRING_CHUNK_SIZE = 8192;

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BINARY_STRING_CHUNK_SIZE) {
    const slice = bytes.subarray(offset, offset + BINARY_STRING_CHUNK_SIZE);
    binary += String.fromCharCode(...slice);
  }
  return binary;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes));
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export { bytesToBase64, base64ToBytes };

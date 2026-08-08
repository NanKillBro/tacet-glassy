function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function digestsMatch(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

export { bytesToHex, sha256Hex, digestsMatch };

// -- Byte formatting for cache readouts ------------------------------------------

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const formatted = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${formatted} ${UNITS[unitIndex]}`;
}

export { formatBytes };

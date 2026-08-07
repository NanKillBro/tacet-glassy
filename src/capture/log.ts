// Every capture-spike log line is prefixed [BLK-CAP] so a human watching the
// page console (the only console this spike is read from) can filter on it.

const LOG_PREFIX = "[BLK-CAP]";

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`);
}

function logError(message: string, error: unknown): void {
  console.error(`${LOG_PREFIX} ${message}`, error);
}

export { LOG_PREFIX, log, logError };

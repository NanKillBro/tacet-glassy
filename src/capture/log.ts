import { createLogger } from "@/shared/logger";

// The capture patch runs in the page world alongside YouTube's own noise, so it
// keeps a named scope rather than printing under the bare prefix.
const logger = createLogger("capture");

function log(message: string): void {
  logger.log(message);
}

function logError(message: string, error: unknown): void {
  logger.error(message, error);
}

export { log, logError };

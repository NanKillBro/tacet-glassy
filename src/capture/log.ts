import { createLogger } from "@/shared/logger";

const logger = createLogger("capture");

function log(message: string): void {
  logger.log(message);
}

function logError(message: string, error: unknown): void {
  logger.error(message, error);
}

export { log, logError };

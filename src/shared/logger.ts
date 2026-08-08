// One prefix for everything the extension prints, so filtering the console on
// "Tacet" shows all of it and nothing else. The page world, the capture patch,
// the background worker and the offscreen document all print to consoles a user
// may be reading, hence the scope after the prefix.
//
// Free of chrome.*: the page-world bundle imports this, and any chrome reference
// there drags in a runtime that throws on load and kills that script silently.

const PREFIX = "[Tacet]";

let enabled = true;

interface Logger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function createLogger(scope?: string): Logger {
  const label = scope ? `${PREFIX}[${scope}]` : PREFIX;
  return {
    log: (...args: unknown[]) => {
      if (enabled) console.log(label, ...args);
    },
    warn: (...args: unknown[]) => {
      if (enabled) console.warn(label, ...args);
    },
    // Errors always print: a silenced failure is how this went dark before.
    error: (...args: unknown[]) => console.error(label, ...args),
  };
}

function setLoggingEnabled(value: boolean): void {
  enabled = value;
}

export { createLogger, PREFIX, setLoggingEnabled };
export type { Logger };

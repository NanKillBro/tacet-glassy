// The hard bypass, and the one guarantee that a listener never loses their
// audio: the stop message and the context watchdog both funnel through
// enterBypass rather than each restoring the original their own way. Starts
// bypassed, since the original is audible until something turns it down.

interface BypassControllerDeps {
  restoreOriginal(): void;
  stopStems(): void;
}

interface BypassController {
  isBypassed(): boolean;
  enterBypass(): void;
  exitBypass(): void;
}

function createBypassController(deps: BypassControllerDeps): BypassController {
  let bypassed = true;

  function enterBypass(): void {
    if (bypassed) return;
    bypassed = true;
    deps.restoreOriginal();
    deps.stopStems();
  }

  function exitBypass(): void {
    bypassed = false;
  }

  return { isBypassed: () => bypassed, enterBypass, exitBypass };
}

export { createBypassController };
export type { BypassController, BypassControllerDeps };

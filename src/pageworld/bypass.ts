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

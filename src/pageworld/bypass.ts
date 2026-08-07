// The hard bypass. This is the one path that guarantees a listener never
// loses their audio: the "stop stems" message and the context-state
// watchdog both funnel through enterBypass, so there is exactly one place
// that reconnects the element and stops the stems, not two that could drift
// apart. Starts bypassed, since the shared source node begins connected to
// the destination and nothing has touched it yet.

interface BypassControllerDeps {
  reconnectDestination(): void;
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
    deps.reconnectDestination();
    deps.stopStems();
  }

  function exitBypass(): void {
    bypassed = false;
  }

  return { isBypassed: () => bypassed, enterBypass, exitBypass };
}

export { createBypassController };
export type { BypassController, BypassControllerDeps };

// Ported from docs/mocks/2026-08-07-singalong-fader-v3.html (better-lyrics repo).
// Position is a rAF spring, never a CSS transition, so grabbing the handle
// mid-flight retargets instead of restarting. The value the caller wants
// updates instantly; only the pixels spring.

type SpringMode = "drag" | "settle";

interface SpringProfile {
  stiffness: number;
  damping: number;
}

// Under the finger: stiff and near-critical (damping ratio ~0.97) so the
// handle has weight without lagging. On release, taps and keys: softer,
// damping ratio ~0.60, roughly 9% overshoot.
const SPRING_PROFILES: Record<SpringMode, SpringProfile> = {
  drag: { stiffness: 900, damping: 58 },
  settle: { stiffness: 200, damping: 17 },
};

// A backgrounded tab can deliver one rAF callback with a multi-second delta.
// Clamping the integration step stops that from flinging the handle.
const MAX_STEP_SECONDS = 0.032;

const SETTLE_POSITION_EPSILON = 0.0004;
const SETTLE_VELOCITY_EPSILON = 0.004;

interface SpringState {
  x: number;
  vel: number;
}

interface SteppedSpringState extends SpringState {
  settled: boolean;
}

function stepSpring(state: SpringState, target: number, profile: SpringProfile, dtSeconds: number): SteppedSpringState {
  const dt = Math.min(dtSeconds, MAX_STEP_SECONDS);
  const acceleration = -profile.stiffness * (state.x - target) - profile.damping * state.vel;
  const vel = state.vel + acceleration * dt;
  const x = state.x + vel * dt;

  if (Math.abs(x - target) < SETTLE_POSITION_EPSILON && Math.abs(vel) < SETTLE_VELOCITY_EPSILON) {
    return { x: target, vel: 0, settled: true };
  }
  return { x, vel, settled: false };
}

// -- Scheduler --------------------------------------------------------------

interface SpringDeps {
  requestAnimationFrame(callback: (time: number) => void): number;
  prefersReducedMotion(): boolean;
}

interface Spring {
  set(next: number, mode?: SpringMode): void;
  jump(next: number): void;
}

function createSpring(onFrame: (x: number) => void, deps: SpringDeps): Spring {
  let state: SpringState = { x: 0, vel: 0 };
  let target = 0;
  let mode: SpringMode = "settle";
  let frameHandle = 0;

  function tick(now: number, prev: number): void {
    const stepped = stepSpring(state, target, SPRING_PROFILES[mode], (now - prev) / 1000);
    state = { x: stepped.x, vel: stepped.vel };

    if (stepped.settled) {
      frameHandle = 0;
      onFrame(state.x);
      return;
    }
    onFrame(state.x);
    frameHandle = deps.requestAnimationFrame(next => tick(next, now));
  }

  return {
    set(next, nextMode = "settle") {
      target = next;
      mode = nextMode;
      if (deps.prefersReducedMotion()) {
        state = { x: target, vel: 0 };
        onFrame(state.x);
        return;
      }
      if (!frameHandle) {
        frameHandle = deps.requestAnimationFrame(now => tick(now, now - 16));
      }
    },
    jump(next) {
      target = next;
      state = { x: next, vel: 0 };
      onFrame(state.x);
    },
  };
}

export { SPRING_PROFILES, MAX_STEP_SECONDS, stepSpring, createSpring };
export type { SpringMode, SpringProfile, SpringState, SteppedSpringState, SpringDeps, Spring };

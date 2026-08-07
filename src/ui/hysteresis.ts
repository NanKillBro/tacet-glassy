// Ported from the resolveMount/mountTo pair in
// docs/mocks/2026-08-07-singalong-mounts.html (better-lyrics repo).
//
// The mount is a relationship, not a one-off lookup: YouTube Music
// re-renders constantly, the dock only exists while lyrics are up, and it
// can be switched off in settings. Arriving at the dock is instant. Leaving
// it is debounced, and asymmetrically so: waiting is free while the control
// is still on screen somewhere, but only worth 250ms once it has gone with
// the dock and the user has no control at all.

type MountTarget = "dock" | "bar";

const LEAVE_DELAY_VISIBLE_MS = 2000;
const LEAVE_DELAY_ABSENT_MS = 250;

interface MountResolverOptions {
  leaveDelayVisibleMs?: number;
  leaveDelayAbsentMs?: number;
  isDockPresent(): boolean;
  isControlMountedToDock(): boolean;
  isControlMountedToBar(): boolean;
  isControlVisible(): boolean;
  mountTo(target: MountTarget): void;
}

interface MountResolver {
  resolve(force?: boolean): void;
  currentTarget(): MountTarget;
  dispose(): void;
}

function createMountResolver(options: MountResolverOptions): MountResolver {
  const leaveDelayVisibleMs = options.leaveDelayVisibleMs ?? LEAVE_DELAY_VISIBLE_MS;
  const leaveDelayAbsentMs = options.leaveDelayAbsentMs ?? LEAVE_DELAY_ABSENT_MS;

  let target: MountTarget = "bar";
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  function resolve(force = false): void {
    if (options.isDockPresent()) {
      if (leaveTimer !== null) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      if (target !== "dock" || !options.isControlMountedToDock()) {
        target = "dock";
        options.mountTo("dock");
      }
      return;
    }

    // Wait out a missing dock only while the control is still usable. If it
    // went with the dock there is nothing left to protect, so wait only long
    // enough to absorb a re-render that spans a few frames.
    if (target === "dock" && !force) {
      if (leaveTimer === null) {
        const delay = options.isControlVisible() ? leaveDelayVisibleMs : leaveDelayAbsentMs;
        leaveTimer = setTimeout(() => {
          leaveTimer = null;
          resolve(true);
        }, delay);
      }
      return;
    }

    if (target !== "bar" || !options.isControlMountedToBar()) {
      target = "bar";
      options.mountTo("bar");
    }
  }

  function dispose(): void {
    if (leaveTimer !== null) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }

  return { resolve, currentTarget: () => target, dispose };
}

export { LEAVE_DELAY_VISIBLE_MS, LEAVE_DELAY_ABSENT_MS, createMountResolver };
export type { MountTarget, MountResolverOptions, MountResolver };

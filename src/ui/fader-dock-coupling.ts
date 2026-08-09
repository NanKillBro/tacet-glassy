interface DockCouplingState {
  weExpandedDock: boolean;
}

function initialDockCouplingState(): DockCouplingState {
  return { weExpandedDock: false };
}

interface DockCouplingOpenResult {
  state: DockCouplingState;
  addExpandedClass: boolean;
}

function dockCouplingCardOpened(dockExpanded: boolean): DockCouplingOpenResult {
  if (dockExpanded) return { state: { weExpandedDock: false }, addExpandedClass: false };
  return { state: { weExpandedDock: true }, addExpandedClass: true };
}

interface DockCouplingCloseResult {
  state: DockCouplingState;
  removeExpandedClass: boolean;
}

function dockCouplingCardClosed(state: DockCouplingState): DockCouplingCloseResult {
  if (!state.weExpandedDock) return { state, removeExpandedClass: false };
  return { state: initialDockCouplingState(), removeExpandedClass: true };
}

function dockCouplingShouldCloseCard(cardOpen: boolean, dockExpanded: boolean, pointerOnCard = false): boolean {
  return cardOpen && !dockExpanded && !pointerOnCard;
}

export { initialDockCouplingState, dockCouplingCardOpened, dockCouplingCardClosed, dockCouplingShouldCloseCard };
export type { DockCouplingState };

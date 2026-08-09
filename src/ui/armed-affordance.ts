const ARMED_LABEL = "Karaoke starts when this finishes";

function shouldShowActivePill(committedValue: number, busy: boolean): boolean {
  return committedValue !== 0 && !busy;
}

export { ARMED_LABEL, shouldShowActivePill };

const ARMED_LABEL = "Karaoke starts when this finishes";

function shouldShowActivePill(committedValue: number, busy: boolean): boolean {
  return committedValue !== 0 && !busy;
}

function labelWhileBusy(stageLabel: string, armed: boolean): string {
  return armed ? ARMED_LABEL : stageLabel;
}

export { ARMED_LABEL, shouldShowActivePill, labelWhileBusy };

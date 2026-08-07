function isFaderInteractive(disabled: boolean): boolean {
  return !disabled;
}

function shouldCloseForDisabled(open: boolean, disabled: boolean): boolean {
  return open && disabled;
}

export { isFaderInteractive, shouldCloseForDisabled };

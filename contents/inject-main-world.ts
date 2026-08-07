import type { PlasmoCSConfig } from "plasmo";

// Phase 7 injects the page-world audio graph script from here. Empty until
// then: both scripts this content script used to inject belonged to the
// abandoned spike paths.

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
};

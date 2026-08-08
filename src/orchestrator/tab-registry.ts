interface TabRegistry {
  remember(videoId: string, tabId: number): void;
  tabsFor(videoId: string): number[];
  forgetVideo(videoId: string): void;
  forgetTab(tabId: number): void;
  videoCount(): number;
}

function createTabRegistry(): TabRegistry {
  const tabsByVideoId = new Map<string, Set<number>>();

  function remember(videoId: string, tabId: number): void {
    const existing = tabsByVideoId.get(videoId);
    if (existing) existing.add(tabId);
    else tabsByVideoId.set(videoId, new Set([tabId]));
  }

  function tabsFor(videoId: string): number[] {
    return [...(tabsByVideoId.get(videoId) ?? [])];
  }

  function forgetVideo(videoId: string): void {
    tabsByVideoId.delete(videoId);
  }

  function forgetTab(tabId: number): void {
    for (const [videoId, tabs] of tabsByVideoId) {
      tabs.delete(tabId);
      if (tabs.size === 0) tabsByVideoId.delete(videoId);
    }
  }

  return { remember, tabsFor, forgetVideo, forgetTab, videoCount: () => tabsByVideoId.size };
}

export { createTabRegistry };
export type { TabRegistry };

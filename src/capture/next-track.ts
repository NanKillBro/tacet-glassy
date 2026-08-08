// YouTube Music's player reports an empty getPlaylist() even with fifty tracks
// queued, so the queue is read from its own rendered items instead. Measured on
// a radio queue: 50 ytmusic-player-queue-item elements, the id on the element's
// own `data` property, and only the playing one carrying the selected
// attribute. `__data` is absent on these, so it is only a fallback.

const QUEUE_ITEM_SELECTOR = "ytmusic-player-queue-item";
const SELECTED_ATTRIBUTE = "selected";

interface QueueItem {
  videoId: string | null;
  selected: boolean;
}

function nextVideoIdInQueue(items: readonly QueueItem[], currentVideoId: string | null): string | null {
  if (items.length === 0) return null;

  let currentIndex = items.findIndex(item => item.selected);
  if (currentIndex === -1 && currentVideoId) {
    currentIndex = items.findIndex(item => item.videoId === currentVideoId);
  }
  if (currentIndex === -1 || currentIndex >= items.length - 1) return null;

  const next = items[currentIndex + 1].videoId;
  if (!next || next === currentVideoId) return null;
  return next;
}

interface QueueItemData {
  videoId?: unknown;
  navigationEndpoint?: { watchEndpoint?: { videoId?: unknown } };
}

interface PolymerQueueItem extends Element {
  data?: QueueItemData;
  __data?: { data?: QueueItemData };
}

function firstVideoId(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function readQueueItemVideoId(element: PolymerQueueItem): string | null {
  const own = element.data;
  const polymer = element.__data?.data;
  return firstVideoId(
    own?.videoId,
    own?.navigationEndpoint?.watchEndpoint?.videoId,
    polymer?.videoId,
    polymer?.navigationEndpoint?.watchEndpoint?.videoId
  );
}

function readQueueItems(doc: Document): QueueItem[] {
  return Array.from(doc.querySelectorAll<PolymerQueueItem>(QUEUE_ITEM_SELECTOR)).map(element => ({
    videoId: readQueueItemVideoId(element),
    selected: element.hasAttribute(SELECTED_ATTRIBUTE),
  }));
}

export { nextVideoIdInQueue, readQueueItems, QUEUE_ITEM_SELECTOR, SELECTED_ATTRIBUTE };
export type { QueueItem };

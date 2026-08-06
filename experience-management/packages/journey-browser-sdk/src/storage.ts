import type { JourneyQueueStorage, StorageLike } from './types.js';

/** Wraps first-party Storage without reading a browser global at module load. */
export function createLocalStorageQueueStorage(storage: StorageLike): JourneyQueueStorage {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => { storage.setItem(key, value); },
    removeItem: (key) => { storage.removeItem(key); }
  };
}

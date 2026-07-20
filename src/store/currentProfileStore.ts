// Persists the "live" in-progress profile — the one auto-saved on every keystroke, as
// opposed to the explicit multi-file library in fileHistory.ts. This used to live in
// localStorage, which caps out around 5-10MB per origin depending on the browser. A
// Condition Report with a few dozen full-resolution embedded photos blows straight past
// that: `localStorage.setItem` would throw, and the old fallback silently wrote the
// profile back with `photos: []` so *something* saved rather than nothing — which meant
// every photo in the live session vanished on the next reload, with no warning. IndexedDB
// has no such small cap (typically a meaningful fraction of free disk space), so moving
// the live auto-save here removes the failure mode entirely instead of papering over it.
const DB_NAME = 'property-inventory-current';
const DB_VERSION = 1;
const STORE_NAME = 'current';
const KEY = 'current';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Returns the raw JSON-parsed value previously saved, or null if there's nothing yet
// (first run) or the read fails for any reason (corrupted DB, browser storage disabled).
export async function loadCurrentProfile(): Promise<unknown | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveCurrentProfile(data: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id: KEY, data });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearCurrentProfile(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

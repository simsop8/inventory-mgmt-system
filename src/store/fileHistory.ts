// Local library of every file the user has explicitly "Saved" from the app.
// Stored in IndexedDB (not localStorage) so it can comfortably hold many
// properties worth of data, including embedded photos.
//
// This is what powers:
//  - The "Saved Files" browser (load any past save back into the app)
//  - "Backup" (write every entry here into a folder on disk in one go)

const DB_NAME = 'property-inventory-files';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

export interface SavedFileEntry {
  id: string;
  filename: string;
  savedAt: string;
  json: string;
}

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

// Looks for an existing entry with the same filename (case-insensitive) so a repeat
// save of the same property overwrites it in place instead of piling up a new entry
// every time — one entry per property/filename, latest save wins.
function findEntryIdByFilename(db: IDBDatabase, filename: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const results = req.result as SavedFileEntry[];
      const match = results.find(r => r.filename.toLowerCase() === filename.toLowerCase());
      resolve(match ? match.id : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addSavedFile(filename: string, json: string): Promise<SavedFileEntry> {
  const db = await openDB();
  const existingId = await findEntryIdByFilename(db, filename);
  const entry: SavedFileEntry = {
    id: existingId || crypto.randomUUID(),
    filename,
    savedAt: new Date().toISOString(),
    json,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry); // put() with a pre-existing id updates that record in place
    tx.oncomplete = () => resolve(entry);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllSavedFiles(): Promise<SavedFileEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const results = req.result as SavedFileEntry[];
      results.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

// Renames an entry in place — same id, same content, just a new filename.
export async function renameSavedFile(id: string, newFilename: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result as SavedFileEntry | undefined;
      if (entry) {
        entry.filename = newFilename;
        store.put(entry);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSavedFile(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

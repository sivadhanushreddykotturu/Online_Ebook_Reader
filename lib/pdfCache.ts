import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'pdf-cache';
const DB_VERSION = 1;
const STORE_NAME = 'pdfs';

// Singleton promise — only opens the DB once
let dbPromise: Promise<IDBPDatabase> | null = null;

export function openPdfCache(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // Key is r2Key (string), value is the raw ArrayBuffer
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Returns the cached ArrayBuffer for the given r2Key,
 * or null if not found / IndexedDB unavailable.
 */
export async function getCachedPdf(r2Key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openPdfCache();
    const result: ArrayBuffer | undefined = await db.get(STORE_NAME, r2Key);
    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Stores the PDF ArrayBuffer in IndexedDB keyed by r2Key.
 * Silently swallows errors (e.g. storage quota exceeded).
 */
export async function cachePdf(r2Key: string, buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openPdfCache();
    await db.put(STORE_NAME, buffer, r2Key);
  } catch (err) {
    console.warn('[pdfCache] Failed to cache PDF:', err);
  }
}

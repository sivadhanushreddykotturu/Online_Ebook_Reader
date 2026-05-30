import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'pdf-reader-bookmarks';
const DB_VERSION = 1;
const STORE_NAME = 'bookmarks';

export interface CachedBookmark {
  _id?: string;
  bookId: string;
  pageNumber: number;
  note: string;
  createdAt: string;
  /** Marks bookmarks created/deleted offline that need server sync */
  pendingSync?: 'add' | 'delete';
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function openBookmarkCache(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

/** Get all cached bookmarks for a book */
export async function getCachedBookmarks(bookId: string): Promise<CachedBookmark[]> {
  try {
    const db = await openBookmarkCache();
    const result: CachedBookmark[] | undefined = await db.get(STORE_NAME, bookId);
    return result ?? [];
  } catch {
    return [];
  }
}

/** Replace entire bookmark list for a book (used after server fetch) */
export async function setCachedBookmarks(bookId: string, bookmarks: CachedBookmark[]): Promise<void> {
  try {
    const db = await openBookmarkCache();
    await db.put(STORE_NAME, bookmarks, bookId);
  } catch (err) {
    console.warn('[bookmarkCache] Failed to cache bookmarks:', err);
  }
}

/** Add or update a single bookmark in the cache */
export async function addCachedBookmark(bookId: string, bookmark: CachedBookmark): Promise<void> {
  try {
    const existing = await getCachedBookmarks(bookId);
    const idx = existing.findIndex((b) => b.pageNumber === bookmark.pageNumber);
    if (idx >= 0) {
      existing[idx] = bookmark;
    } else {
      existing.push(bookmark);
    }
    existing.sort((a, b) => a.pageNumber - b.pageNumber);
    await setCachedBookmarks(bookId, existing);
  } catch (err) {
    console.warn('[bookmarkCache] Failed to add bookmark:', err);
  }
}

/** Remove a bookmark from the cache */
export async function removeCachedBookmark(bookId: string, pageNumber: number): Promise<void> {
  try {
    const existing = await getCachedBookmarks(bookId);
    const filtered = existing.filter((b) => b.pageNumber !== pageNumber);
    await setCachedBookmarks(bookId, filtered);
  } catch (err) {
    console.warn('[bookmarkCache] Failed to remove bookmark:', err);
  }
}

/** Get bookmarks that need syncing to server */
export async function getPendingSyncBookmarks(bookId: string): Promise<CachedBookmark[]> {
  const all = await getCachedBookmarks(bookId);
  return all.filter((b) => b.pendingSync);
}

/** Clear pending sync flags after successful server sync */
export async function clearPendingSyncFlags(bookId: string): Promise<void> {
  const all = await getCachedBookmarks(bookId);
  const cleaned = all
    .filter((b) => b.pendingSync !== 'delete')
    .map((b) => ({ ...b, pendingSync: undefined }));
  await setCachedBookmarks(bookId, cleaned);
}

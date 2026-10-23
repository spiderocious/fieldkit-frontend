// Where photos go. OPFS (real files, private to the origin) when the browser
// can write them from the page; otherwise Blobs in IndexedDB behind the same
// three functions. The app never knows which.
import type { OfflineDb } from './db';

export type PhotoTier = 'opfs' | 'indexeddb';

const ROOT = 'photos';

async function opfsDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(ROOT, { create });
  } catch {
    return null;
  }
}

async function opfsWrite(key: string, blob: Blob): Promise<boolean> {
  const dir = await opfsDir(true);
  if (!dir) return false;
  try {
    const handle = await dir.getFileHandle(key, { create: true });
    // createWritable is missing in Safari; the catch sends us to IndexedDB.
    const writable = await (handle as FileSystemFileHandle & {
      createWritable?: () => Promise<FileSystemWritableFileStream>;
    }).createWritable?.();
    if (!writable) return false;
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

async function opfsRead(key: string): Promise<Blob | undefined> {
  const dir = await opfsDir(false);
  if (!dir) return undefined;
  try {
    const handle = await dir.getFileHandle(key);
    return await handle.getFile();
  } catch {
    return undefined;
  }
}

async function opfsDelete(key: string): Promise<void> {
  const dir = await opfsDir(false);
  if (!dir) return;
  try {
    await dir.removeEntry(key);
  } catch {
    // already gone
  }
}

/** Stores a photo and returns the tier that took it. */
export async function putPhoto(db: OfflineDb, key: string, blob: Blob): Promise<PhotoTier> {
  if (await opfsWrite(key, blob)) {
    await db.setKv('photoTier', 'opfs');
    return 'opfs';
  }
  await db.blobs.put({ key, bytes: await blob.arrayBuffer(), type: blob.type, size: blob.size });
  await db.setKv('photoTier', 'indexeddb');
  return 'indexeddb';
}

/** Reads a photo from whichever tier has it. */
export async function getPhoto(db: OfflineDb, key: string): Promise<Blob | undefined> {
  const fromOpfs = await opfsRead(key);
  if (fromOpfs) return fromOpfs;
  const row = await db.blobs.get(key);
  return row ? new Blob([row.bytes], { type: row.type }) : undefined;
}

export async function deletePhoto(db: OfflineDb, key: string): Promise<void> {
  await opfsDelete(key);
  await db.blobs.delete(key);
}

/** Which tier the last write used, for the panel. */
export async function photoTier(db: OfflineDb): Promise<PhotoTier | 'none'> {
  return db.getKv<PhotoTier | 'none'>('photoTier', 'none');
}

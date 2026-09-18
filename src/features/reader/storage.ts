const DIR = 'books';

export function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

async function booksDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

/**
 * `createWritable` TRUNCATES on open, so a write that dies part-way — the tab closing, storage filling
 * up — leaves a valid handle over partial bytes. Everything downstream then treats the book as present:
 * the cloud fetch skips it as "already local", the parser chokes on the fragment, and nothing ever
 * repairs it. Removing the entry on failure keeps the only two states the rest of the code can handle:
 * the whole file, or nothing.
 */
export async function saveBookFile(id: string, file: Blob): Promise<void> {
  try {
    const dir = await booksDir();
    const handle = await dir.getFileHandle(id, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
  } catch (e) {
    await deleteBookFile(id);
    throw e;
  }
}

export async function getBookFile(id: string): Promise<File> {
  const dir = await booksDir();
  const handle = await dir.getFileHandle(id);
  const file = await handle.getFile();
  // An empty file is not a book. Treating it as one made a half-written entry look local forever, so
  // the cloud copy was never fetched and the parser failed on nothing.
  if (file.size === 0) throw new DOMException('empty book file', 'NotFoundError');
  return file;
}

export async function deleteBookFile(id: string): Promise<void> {
  try {
    const dir = await booksDir();
    await dir.removeEntry(id);
  } catch {
    // already gone — nothing to do
  }
}

/**
 * Drop every stored book file at once, for when the device passes to a DIFFERENT account.
 *
 * Whole-directory rather than per-id because the ids are exactly what is no longer knowable: the book
 * rows are cleared on logout, long before we learn who signs in next. `booksDir` recreates it on demand.
 */
export async function discardAllBookFiles(): Promise<void> {
  // A browser with no OPFS has no book files, so there is nothing to fail at. Without this the missing
  // `navigator.storage` raises a TypeError rather than a DOMException, the caller reads it as a real
  // failure, and the device stays pinned to the first account that ever used it.
  if (!opfsAvailable()) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DIR, { recursive: true });
  } catch (e) {
    // "nothing stored here" is success. Anything else — a locked handle, a quota error — is a real
    // failure and must propagate, or the caller claims the device for the next account while the
    // previous one's books are still on it, with nothing left to retry from.
    if (!(e instanceof DOMException) || e.name !== 'NotFoundError') throw e;
  }
}

/**
 * Ask the browser to keep storage durable. Chrome grants it silently; Safari only makes
 * OPFS reliable once the app is installed to the home screen, so a false result here is a
 * real data-loss risk the import flow must surface to the user (§4/§12.6).
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

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

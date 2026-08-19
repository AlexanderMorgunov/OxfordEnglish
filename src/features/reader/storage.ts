const DIR = 'books';

export function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

async function booksDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

export async function saveBookFile(id: string, file: Blob): Promise<void> {
  const dir = await booksDir();
  const handle = await dir.getFileHandle(id, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
}

export async function getBookFile(id: string): Promise<File> {
  const dir = await booksDir();
  const handle = await dir.getFileHandle(id);
  return handle.getFile();
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

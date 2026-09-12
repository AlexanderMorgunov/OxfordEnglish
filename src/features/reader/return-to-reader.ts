const KEY = 'reader.lastPath';

/** Remember which book page the reader was on, so a trip into the app can come back to the book
 *  itself rather than one step back in history (which lands wrong as soon as the user goes deeper). */
export function rememberReader(path: string): void {
  try {
    localStorage.setItem(KEY, path);
  } catch {
    // best-effort — the back link falls back to history
  }
}

export function readerReturnPath(): string | null {
  try {
    const path = localStorage.getItem(KEY);
    return path && path.startsWith('/library/') ? path : null;
  } catch {
    return null;
  }
}

/** The marker the reader widget puts on its links; pages show the back link only when it's present. */
export const FROM_READER = 'from=reader';

export const withReaderReturn = (to: string): string =>
  `${to}${to.includes('?') ? '&' : '?'}${FROM_READER}`;

/**
 * True inside the Capacitor app rather than a browser tab.
 *
 * Read off the global Capacitor injects instead of importing `@capacitor/core`: a static import would
 * pull the whole runtime into the web bundle to answer one boolean, and this is asked in code that
 * ships to both.
 */
export function isNativePlatform(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

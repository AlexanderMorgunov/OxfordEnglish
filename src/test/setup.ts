import '@testing-library/jest-dom/vitest';

// The UI language store defaults to Russian (its first-run default). Pin tests to English so
// assertions on English UI labels stay stable as chrome gets localized. Must run before any
// component imports the uiLang store, i.e. here in the shared setup file.
localStorage.setItem('oxford-ui-lang', 'en');

// jsdom implements no matchMedia, but components query it during render (the PWA standalone check,
// prefers-reduced-motion). Without this stub any test that mounts the app shell throws.
const noop = () => undefined;
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => false,
  });
}

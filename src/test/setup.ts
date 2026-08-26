import '@testing-library/jest-dom/vitest';

// The UI language store defaults to Russian (its first-run default). Pin tests to English so
// assertions on English UI labels stay stable as chrome gets localized. Must run before any
// component imports the uiLang store, i.e. here in the shared setup file.
localStorage.setItem('oxford-ui-lang', 'en');

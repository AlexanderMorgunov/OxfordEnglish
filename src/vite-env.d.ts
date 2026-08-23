/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.css';

/** App version, injected from package.json at build time (see vite.config.ts `define`). */
declare const __APP_VERSION__: string;

/** Build-time env (from a gitignored `.env`, or the host's build settings). Never committed. */
interface ImportMetaEnv {
  readonly VITE_WEB3FORMS_ACCESS_KEY?: string;
  readonly VITE_FEEDBACK_ENDPOINT?: string;
  readonly VITE_FEEDBACK_EMAIL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

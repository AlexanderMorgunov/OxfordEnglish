/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt', not 'autoUpdate': a new deploy surfaces a visible "Обновить" banner and applies
      // only on the user's action (see src/features/pwa/update.ts) — no silent reload mid-reading,
      // and an open PWA is polled so it actually notices new versions.
      registerType: 'prompt',
      // Registration is manual via virtual:pwa-register in initAppUpdate(); disabling auto-injection
      // keeps it from being injected into the second HTML entry (migrate.html), which must NOT
      // register a service worker — it's the standalone .online→.ru migration receiver.
      injectRegister: null,
      includeAssets: ['icons/app-256.png', 'icons/app-512.png', 'icons/app-512-maskable.png'],
      manifest: {
        name: 'DayEnglish',
        short_name: 'DayEnglish',
        description: 'Offline-first English course, A1 → B1, with a book reader.',
        theme_color: '#12141c',
        background_color: '#12141c',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/app-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
          { src: 'icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/app-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache ONLY the app shell — NOT the content packs. Precaching the whole library
        // (~50MB / 2000+ audio+JSON files) made the service worker download everything on first
        // visit, choking the initial load. Pack media is runtime-cached on demand below (and stays
        // available offline once opened).
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        globIgnores: ['**/packs/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/packs\//, /^\/migrate\.html$/],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3_000_000,
        runtimeCaching: [
          {
            urlPattern: /\/packs\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'content-packs',
              expiration: {
                maxEntries: 1000,
                maxAgeSeconds: 60 * 60 * 24 * 90,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      // Two HTML entries: the app, and the standalone .online→.ru migration receiver. index.html MUST
      // be listed explicitly — once `input` is set, Rollup no longer picks it up on its own.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        migrate: fileURLToPath(new URL('./migrate.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});

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
      // 'autoUpdate', not 'prompt': the SW self-activates (skipWaiting + clientsClaim) and the page
      // reloads onto the fresh build. This is what heals a client stuck on an OLD cached SW — a
      // prompt-mode SW only updates on the user's click, so a stale course.json kept hiding new days
      // on installed PWAs / returning visitors. Update checks run on focus/visibility, not a timer,
      // so an actively-used session isn't reloaded mid-exercise (see src/features/pwa/update.ts).
      registerType: 'autoUpdate',
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
        navigateFallbackDenylist: [/^\/packs\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3_000_000,
        runtimeCaching: [
          {
            // Pack JSON (course.json, days/*.json, manifest.json) CHANGES when content is added or
            // edited, so it must revalidate — CacheFirst would pin the first course.json forever and
            // new days would never appear. NetworkFirst serves fresh when online (new content shows
            // up on the next load) and falls back to cache offline after a short timeout.
            urlPattern: /\/packs\/.*\.json(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'content-json',
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 90,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Pack media (audio, images) is immutable — new assets get new filenames — so CacheFirst
            // keeps it offline-first without ever needing revalidation.
            urlPattern: /\/packs\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'content-packs',
              expiration: {
                maxEntries: 3000,
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

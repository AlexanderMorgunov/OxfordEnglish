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
      registerType: 'autoUpdate',
      includeAssets: ['icons/app-256.png'],
      manifest: {
        name: 'English for Developers',
        short_name: 'en/dev',
        description: 'Offline-first English course for developers, A1 → B1, with a book reader.',
        theme_color: '#12141c',
        background_color: '#12141c',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/app-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,json,wav,mp3}'],
        maximumFileSizeToCacheInBytes: 5_000_000,
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

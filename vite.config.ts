/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

/**
 * Content-Security-Policy solo nel build pubblicato: limita script e connessioni all'app stessa
 * e alle API Google usate per Drive e Calendario. Non nel server di sviluppo (usa script inline)
 * né nell'anteprima VITE_NO_SW, che viene incorporata in un unico file HTML.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://www.googleapis.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  let preview = false;
  return {
    name: 'skiwork-csp',
    apply: 'build',
    configResolved: (config) => {
      preview = Boolean(config.env.VITE_NO_SW);
    },
    transformIndexHtml: () => (preview ? [] : [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }]),
  };
}

export default defineConfig({
  plugins: [
    react(),
    csp(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'SkiWork',
        short_name: 'SkiWork',
        description: 'Gestione del lavoro da maestro di sci e allenatore',
        lang: 'it',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

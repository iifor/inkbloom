/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { offlineBuild } from './scripts/offline-build';

export default defineConfig({
  base: './',
  plugins: [offlineBuild()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api/admin/v1': 'http://127.0.0.1:5195',
      '/api/traveller-plan': 'http://127.0.0.1:5195',
      '/multiplayer': {
        target: 'ws://127.0.0.1:5195',
        ws: true,
        configure(proxy) {
          proxy.on('proxyReqWs', (out, req) =>
            out.setHeader('X-Real-IP', req.socket.remoteAddress ?? '127.0.0.1'),
          );
        },
      },
    },
  },
  build: {
    rollupOptions: {
      input: { game: 'index.html', admin: 'admin/index.html' },
      // three.js is most of the bundle and changes far less often than the game
      output: { manualChunks: { three: ['three'] } },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

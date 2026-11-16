/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: '127.0.0.1' },
  build: {
    rollupOptions: {
      // three.js is most of the bundle and changes far less often than the game
      output: { manualChunks: { three: ['three'] } },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

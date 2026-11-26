import { defineConfig } from 'vite';
import base from '../../vite.config';

// Keep this inspection stable while other local work updates unrelated source files.
export default defineConfig({ ...base, server: { ...base.server, hmr: false, watch: null } });

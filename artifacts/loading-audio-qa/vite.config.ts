import { defineConfig } from 'vite';
import base from '../../vite.config';

export default defineConfig({ ...base, server: { ...base.server, hmr: false } });

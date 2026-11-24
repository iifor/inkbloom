// Package the actual release files, including Vite workers and public assets
// which are loaded by name at runtime and do not appear in the import graph.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export function offlineBuild(): Plugin {
  return {
    name: 'inkbloom-offline-release',
    apply: 'build',
    async writeBundle({ dir }) {
      if (!dir) throw new Error('Offline packaging requires an output directory');
      const output = dir;
      const files: { path: string; size: number; integrity: string }[] = [];
      async function walk(prefix: string) {
        for (const entry of await readdir(resolve(output, prefix), { withFileTypes: true })) {
          const path = prefix + entry.name;
          if (entry.name.startsWith('.') || path === 'admin' || path.startsWith('assets/admin-')) continue;
          if (entry.isDirectory()) await walk(path + '/');
          else if (entry.isFile() && path !== 'offline-worker.js') {
            const bytes = await readFile(resolve(output, path));
            files.push({
              path: path === 'index.html' ? './' : path,
              size: bytes.length,
              integrity: 'sha256-' + createHash('sha256').update(bytes).digest('base64'),
            });
          }
        }
      }
      await walk('');
      files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const manifest = JSON.stringify(files);
      const worker = await readFile(new URL('./offline-worker.js', import.meta.url), 'utf8');
      const version = createHash('sha256').update(manifest).update(worker).digest('hex');
      await writeFile(
        resolve(dir, 'offline-worker.js'),
        'const VERSION = ' + JSON.stringify(version) + ';\nconst FILES = ' + manifest + ';\n' + worker,
      );
    },
  };
}

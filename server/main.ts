// The world server: one world, up to --max players (10 by default), over WebSockets.
//
//   npm run server                      # world "default" on port 5195
//   npm run server -- --world mine --port 5195 --max 10 --host 0.0.0.0
//   INKBLOOM_PASSWORD=secret npm run server   # players must enter the password to join
//   npm run server -- --origin https://my.site  # also let the game served from there connect
//
// Players open the game in a browser and join with ?server=<this machine>:<port> (or the 联机
// screen). The world and every player's own things are saved to world-data/<world>.json. The
// rules live in src/world/net/host.ts, the messaging in serve.ts; this file loads and saves.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashString } from '@/world/math/hash';
import { WorldHost } from '@/world/net/host';
import { DEFAULT_MAX_PLAYERS, DEFAULT_PORT } from '@/world/net/protocol';
import { createWorldState } from '@/world/state';
import { serve } from './serve';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const port = Number(arg('port', String(DEFAULT_PORT)));
const max = Math.max(1, Math.min(32, Number(arg('max', String(DEFAULT_MAX_PLAYERS)))));
const worldName = arg('world', 'default').replace(/[^\w-]/g, '') || 'default';
const bind = arg('host', '0.0.0.0');
// from the environment rather than the command line, which other users of the machine can see
const password = process.env.INKBLOOM_PASSWORD ?? '';
const origins = arg('origin', '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const file = resolve('world-data', `${worldName}.json`);

function loadHost(): WorldHost {
  try {
    const host = WorldHost.load(readFileSync(file, 'utf8'), max);
    console.log(`loaded ${file}`);
    return host;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      // keep the unreadable file for a look later, start a new world beside it
      const aside = `${file}.broken-${Date.now()}`;
      renameSync(file, aside);
      console.warn(`could not read ${file} (${(e as Error).message}); moved it to ${aside}`);
    }
    const state = createWorldState(worldName, hashString(`${worldName}:${Date.now()}`), worldName);
    console.log(`new world "${worldName}" (seed ${state.seed})`);
    return new WorldHost(state, new Map(), max);
  }
}

const host = loadHost();

function save(): void {
  mkdirSync(dirname(file), { recursive: true });
  // write beside it and swap in, so a crash mid-write never leaves half a save
  writeFileSync(`${file}.tmp`, host.save());
  renameSync(`${file}.tmp`, file);
}

await serve(host, { port, bind, password, origins, save, log: (line) => console.log(line) });
console.log(
  `inkbloom world "${worldName}" on ws://${bind}:${port} · up to ${max} players` +
    (password ? ' · password set' : ' · no password (anyone who can reach this port can join)'),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    try {
      save();
      console.log('saved; bye');
    } catch (e) {
      console.error(`could not save: ${(e as Error).message}`);
    }
    process.exit(0);
  });

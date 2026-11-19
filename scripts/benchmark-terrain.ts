// Run with: npx vite-node scripts/benchmark-terrain.ts
// CPU-only, fixed seed/route; this is not a GPU FPS benchmark.
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector';
import { createWilderness } from '../src/world/wilderness/generator';
import { generateWildChunk } from '../src/world/wilderness/chunk';
import { landscapeTiles } from '../src/world/wilderness/landscape';
import { landscapeGeometry, DistantTerrain } from '../src/systems/wilderness/distant-terrain';
import { Group } from 'three';

const session = new Session();
session.connect();
const post = (method: string) =>
  new Promise<any>((resolve, reject) => session.post(method as any, (e, r) => (e ? reject(e) : resolve(r))));
await post('Profiler.enable');
await post('Profiler.start');
const samples = [];
for (let run = 0; run < 3; run++) {
  const w = createWilderness(4242);
  let start = performance.now();
  const hash = createHash('sha256');
  for (const tile of landscapeTiles(-1200, -600)) {
    const steps = landscapeGeometry(w, tile);
    let next = steps.next();
    while (!next.done) next = steps.next();
    for (const name of ['position', 'normal', 'aColor']) {
      const a = next.value.getAttribute(name)?.array;
      if (a) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    }
    next.value.dispose();
  }
  const landscapeMs = performance.now() - start;
  start = performance.now();
  const chunks = [];
  for (let x = -11; x <= -9; x++) for (let z = -6; z <= -4; z++) chunks.push(generateWildChunk(w, x, z));
  hash.update(JSON.stringify(chunks));
  const chunksMs = performance.now() - start;
  const distant = new DistantTerrain(w, new Group());
  const loaded = new Map(),
    p = { x: -1200, y: 100, z: -600 };
  for (let i = 0; i < 2000; i++) distant.update(p, loaded);
  start = performance.now();
  for (let i = 0; i < 3000; i++) distant.update(p, loaded);
  const stationaryMs = performance.now() - start;
  distant.dispose();
  samples.push({
    landscapeMs: Math.round(landscapeMs),
    chunksMs: Math.round(chunksMs),
    stationaryMs: Math.round(stationaryMs),
    hash: hash.digest('hex'),
  });
}
const { profile } = await post('Profiler.stop');
session.disconnect();
const hits = new Map<string, number>();
for (const n of profile.nodes) {
  const f = n.callFrame;
  if (f.url.includes('/src/')) {
    const key = `${f.functionName} (${f.url.split('/src/')[1]}:${f.lineNumber + 1})`;
    hits.set(key, (hits.get(key) ?? 0) + (n.hitCount ?? 0));
  }
}
console.log(
  JSON.stringify({ samples, hotspots: [...hits].sort((a, b) => b[1] - a[1]).slice(0, 15) }, null, 2),
);

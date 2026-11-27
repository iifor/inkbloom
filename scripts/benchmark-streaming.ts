// CPU-only: fixed seed and route, each cooperative step measured independently.
// npx vite-node scripts/benchmark-streaming.ts
import { createHash } from 'node:crypto';
import { createWilderness } from '../src/world/wilderness/generator';
import { generateWildChunkSteps } from '../src/world/wilderness/chunk';
import { buildTerrainSteps } from '../src/systems/wilderness/build-chunk';
import { GeometryBuilder } from '../src/engine/render/geometry-builder';

const w = createWilderness(4242);
const hash = createHash('sha256');
const timings: {
  cx: number;
  stage: string;
  steps: number;
  totalMs: number;
  maxMs: number;
  slow: number[];
}[] = [];
function drain<T>(steps: Generator<void, T>, cx: number, stage: string): T {
  let totalMs = 0,
    maxMs = 0,
    count = 0;
  const slow: number[] = [];
  while (true) {
    const t = performance.now();
    const next = steps.next();
    const ms = performance.now() - t;
    totalMs += ms;
    maxMs = Math.max(maxMs, ms);
    count++;
    if (ms > 8) slow.push(count);
    if (next.done) {
      timings.push({ cx, stage, steps: count, totalMs, maxMs, slow });
      return next.value;
    }
  }
}
for (let cx = 0; cx <= 15; cx++) {
  const chunk = drain(generateWildChunkSteps(w, cx, 0), cx, 'data');
  hash.update(JSON.stringify(chunk));
  const g = new GeometryBuilder();
  drain(buildTerrainSteps(chunk, w, g), cx, 'mesh');
  const geometry = g.build();
  for (const name of Object.keys(geometry.attributes).sort()) {
    const a = geometry.getAttribute(name).array;
    hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  }
  geometry.dispose();
}
console.log(JSON.stringify({ hash: hash.digest('hex'), timings }, null, 2));

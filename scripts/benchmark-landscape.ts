// CPU-only fixed-route landscape streaming. The digest checks completed visible geometry.
// npx vite-node scripts/benchmark-landscape.ts
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DistantTerrain,
  landscapeGeometry,
  mergeLandscapeSteps,
} from '../src/systems/wilderness/distant-terrain';
import { createWilderness } from '../src/world/wilderness/generator';
import { landscapeTiles } from '../src/world/wilderness/landscape';

// Isolate the synchronous merge from all other streaming work, using a dense near block.
{
  const world = createWilderness(4242);
  const tiles = landscapeTiles(64, 64).filter((t) => t.x >= 0 && t.x < 1024 && t.z >= 0 && t.z < 1024);
  const geometries = tiles.map((tile) => {
    const work = landscapeGeometry(world, tile);
    let next = work.next();
    while (!next.done) next = work.next();
    return next.value;
  });
  const measurements = [];
  for (let run = 0; run < 6; run++) {
    const start = performance.now();
    const original = mergeGeometries(geometries)!;
    original.computeBoundingSphere();
    const synchronousMs = performance.now() - start;
    const work = mergeLandscapeSteps(geometries);
    let maxStepMs = 0;
    while (true) {
      const start = performance.now();
      const next = work.next();
      maxStepMs = Math.max(maxStepMs, performance.now() - start);
      if (next.done) {
        next.value.dispose();
        break;
      }
    }
    original.dispose();
    measurements.push({ synchronousMs, maxStepMs });
  }
  for (const geometry of geometries) geometry.dispose();
  console.log(JSON.stringify({ merge: { tiles: tiles.length, measurements } }));
}

for (let run = 0; run < 3; run++) {
  const root = new THREE.Group();
  const land = new DistantTerrain(createWilderness(4242), root);
  const detail = new Map<string, unknown>();
  const p = new THREE.Vector3(64, 20, 64);
  const settle = () => {
    for (let i = 0; i < 1000; i++) land.update(p, detail);
  };
  settle();
  const samples: number[] = [];
  for (let frame = 0; frame < 900; frame++) {
    p.set(64 + frame * 2, 20, 64 + frame * 0.12);
    const start = performance.now();
    land.update(p, detail);
    samples.push(performance.now() - start);
  }
  settle();
  const hash = createHash('sha256');
  const parts = root.children
    .map((obj) => {
      const g = (obj as THREE.Mesh).geometry;
      const part = createHash('sha256');
      for (const key of Object.keys(g.attributes).sort()) {
        const a = g.getAttribute(key).array;
        part.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
      }
      const a = g.index!.array;
      part.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
      return part.digest('hex');
    })
    .sort();
  hash.update(parts.join('\n'));
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      run,
      totalMs: samples.reduce((a, b) => a + b, 0),
      p95: samples[Math.floor(samples.length * 0.95)],
      max: samples.at(-1),
      over4: samples.filter((t) => t > 4).length,
      batches: parts.length,
      hash: hash.digest('hex'),
    }),
  );
  land.dispose();
}

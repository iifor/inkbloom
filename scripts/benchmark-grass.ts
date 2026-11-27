// npx vite-node scripts/benchmark-grass.ts
// CPU-only streaming benchmark; these timings are not display FPS or GPU measurements.
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GrassField } from '../src/systems/wilderness/grass';
import { createWilderness } from '../src/world/wilderness/generator';

const results = [];
for (let run = 0; run < 3; run++) {
  const root = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 200);
  const field = new GrassField(createWilderness(4242), root, camera);
  const at = new THREE.Vector3(64, 4, 64);
  const update = () => {
    camera.position.copy(at);
    camera.lookAt(at.x, at.y - 0.5, at.z - 10);
    const start = performance.now();
    field.update(at, 1, 1, 0.375);
    return performance.now() - start;
  };
  const settle = () => {
    const frames = [];
    do {
      frames.push(update());
      if (frames.length > 4000) throw new Error('Grass streaming did not settle');
    } while (field.ready === false);
    return frames;
  };
  const startup = settle();
  const moving = [];
  for (let frame = 0; frame < 600; frame++) {
    at.set(64 + frame * 0.08, 4, 64 - frame * 0.35);
    moving.push(update());
  }
  settle();
  at.set(64, 4, 64);
  settle();
  field.invalidate();
  const rebuilding = settle();
  // Compare visible plants independent of creation order, spare buffers and prefetch distance.
  const plants: string[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.InstancedMesh) || !obj.visible) return;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < obj.count; i++) {
      obj.getMatrixAt(i, matrix);
      const x = matrix.elements[12]!,
        z = matrix.elements[14]!;
      if ((x - at.x) ** 2 + (z - at.z) ** 2 >= 47 ** 2) continue;
      plants.push(
        JSON.stringify([obj.name, matrix.elements, ...obj.instanceColor!.array.slice(i * 3, i * 3 + 3)]),
      );
    }
  });
  if (!plants.length) throw new Error('The comparison must include visible plants');
  const stats = (times: number[]) => {
    const sorted = [...times].sort((a, b) => a - b);
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      frames: times.length,
      totalMs: round(times.reduce((a, b) => a + b, 0)),
      p95Ms: round(sorted[Math.floor(sorted.length * 0.95)]!),
      maxMs: round(sorted.at(-1)!),
      over16ms: times.filter((ms) => ms > 16.7).length,
    };
  };
  results.push({
    startup: stats(startup),
    moving: stats(moving),
    rebuilding: stats(rebuilding),
    plants: plants.length,
    hash: createHash('sha256').update(plants.sort().join('\n')).digest('hex'),
  });
  field.dispose();
}
console.log(JSON.stringify(results, null, 2));

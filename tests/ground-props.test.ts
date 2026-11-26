import { expect, it } from 'vitest';
import { PhysicsWorld } from '@/engine/physics/world';
import { addPropCollider } from '@/systems/wilderness/build-ground-props';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { createWilderness } from '@/world/wilderness/generator';
import { pathsOf } from '@/world/wilderness/paths';
import type { GroundPropKind } from '@/world/wilderness/ground-props';

it('rebuilds the same scenery, keeps routes clear and limits collision to solid props', () => {
  const w = createWilderness(173);
  const seen = new Set<GroundPropKind>();
  for (let cz = -2; cz <= 2; cz++)
    for (let cx = -2; cx <= 2; cx++) {
      const chunk = generateWildChunk(w, cx, cz);
      for (const p of chunk.groundProps) {
        seen.add(p.kind);
        expect(pathsOf(w).edgeDistance(p.x, p.z)).toBeGreaterThanOrEqual(5);
        expect(w.townAt(p.x, p.z, 6)).toBeNull();
        const physics = new PhysicsWorld(4);
        addPropCollider(physics, 'chunk', p);
        expect(physics.boxCount > 0).toBe(p.kind !== 'shingle');
        physics.removeGroup('chunk');
        expect(physics.boxCount).toBe(0);
      }
    }
  expect([...seen].sort()).toEqual(['driftwood', 'mossRock', 'outcrop', 'shingle', 'stump', 'windfall']);
  const again = createWilderness(173);
  expect(generateWildChunk(again, 0, 0).groundProps).toEqual(generateWildChunk(w, 0, 0).groundProps);
}, 30000);

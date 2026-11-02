// The infinite wilderness. Streams chunks around the player (one build per frame so walking
// never hitches), owns their colliders, and registers each city entrance and pigment source
// as an interactable.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import { PhysicsWorld } from '@/engine/physics/world';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial, shared } from '@/engine/render/ink-material';
import { disposeTree } from '@/engine/resources';
import type { GameContext, GameScene } from '@/game/types';
import { chunkKey, generateWildChunk } from '@/world/wilderness/chunk';
import { buildChunkGeometry, addChunkColliders } from './build-chunk';
import { buildLandmark } from './build-landmark';
import { WildSources } from './pigment-sources';

interface Loaded {
  readonly mesh: THREE.Mesh;
  readonly release: (() => void)[];
}

const W = TUNING.world;

export class WildScene implements GameScene {
  readonly ref = { kind: 'wild' } as const;
  readonly name = '野外';
  readonly root = new THREE.Group();
  readonly physics = new PhysicsWorld(8);
  private readonly material = makeInkMaterial();
  private readonly loaded = new Map<string, Loaded>();
  private drainT = 0;
  private readonly sources: WildSources;

  constructor(private readonly ctx: GameContext) {
    this.root.name = 'wild';
    this.sources = new WildSources(ctx, this.material, this.root);
  }

  spawn(): { pos: THREE.Vector3; yaw: number } {
    const x = W.chunkSize * 0.5;
    const z = W.chunkSize * 0.5;
    this.ensureAt(x, z);
    const e = this.ctx.wilderness.entranceInCell(0, 0);
    // face the first city
    const yaw = e ? Math.atan2(-(e.x - x), -(e.z - z)) : 0;
    return { pos: new THREE.Vector3(x, this.ctx.wilderness.heightAt(x, z) + 0.05, z), yaw };
  }

  /** Synchronously build the chunk under a point (used before placing the player). */
  ensureAt(x: number, z: number): void {
    this.load(Math.floor(x / W.chunkSize), Math.floor(z / W.chunkSize));
  }

  update(dt: number): void {
    const p = this.ctx.player.position;
    const pcx = Math.floor(p.x / W.chunkSize);
    const pcz = Math.floor(p.z / W.chunkSize);
    // nearest missing chunk first, one per frame
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dx = -W.loadRadius; dx <= W.loadRadius; dx++)
      for (let dz = -W.loadRadius; dz <= W.loadRadius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (this.loaded.has(chunkKey(cx, cz))) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = [cx, cz];
        }
      }
    if (best) this.load(best[0], best[1]);
    for (const [key, item] of this.loaded) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > W.unloadRadius) this.unload(key, item);
    }
    this.sources.update(dt);
    this.drainT -= dt;
    if (this.drainT <= 0) {
      this.drainT = 0.5;
      this.updateDrain();
    }
  }

  /** Push nearby cities' progress into the shader so the wilderness greys around them. */
  updateDrain(): void {
    const p = this.ctx.player.position;
    const near = this.ctx.wilderness
      .entrancesNear(p.x, p.z, 1)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
      .slice(0, TUNING.drain.maxCities);
    near.forEach((e, i) => shared.uCities.value[i]!.set(e.x, e.z, this.ctx.cities.progress(e.cityId), 0));
    shared.uCityCount.value = near.length;
    shared.uSceneSat.value = 1;
  }

  private load(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.loaded.has(key)) return;
    const chunk = generateWildChunk(this.ctx.wilderness, cx, cz);
    const g = buildChunkGeometry(chunk, this.ctx.wilderness, new GeometryBuilder());
    const group = `chunk:${key}`;
    addChunkColliders(chunk, this.physics, group);
    const release: (() => void)[] = [];
    if (chunk.entrance) {
      const e = chunk.entrance;
      const lm = buildLandmark(e, g, this.physics, group);
      const cityName = (): string => this.ctx.cities.layout(e).name;
      release.push(
        this.ctx.interactions.add({
          scene: 'wild',
          pos: lm.doorPos,
          radius: 4,
          label: () => `E 进入 ${cityName()}`,
          activate: () => this.ctx.scenes.enterCity(e),
        }),
      );
    }
    release.push(this.sources.add(chunk.sources));
    const mesh = new THREE.Mesh(g.build(), this.material);
    mesh.name = group;
    this.root.add(mesh);
    this.loaded.set(key, { mesh, release });
  }

  private unload(key: string, item: Loaded): void {
    this.physics.removeGroup(`chunk:${key}`);
    for (const r of item.release) r();
    item.mesh.geometry.dispose();
    item.mesh.removeFromParent();
    this.loaded.delete(key);
  }

  get chunkCount(): number {
    return this.loaded.size;
  }

  activate(): void {
    this.updateDrain();
  }

  dispose(): void {
    for (const [key, item] of [...this.loaded]) this.unload(key, item);
    this.material.dispose();
    disposeTree(this.root);
  }
}

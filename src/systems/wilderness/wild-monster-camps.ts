// Monsters in loaded wilderness chunks. Each chunk's monsters (more where the land is
// drained) appear when it loads and vanish when it unloads; a defeated one stays away for
// `wildRespawnSeconds` of play (a `hunt` patch). They path over a terrain NavGrid built from
// the loaded chunks, with trees and city towers blocked. An ink well's guards come back to it
// even while their chunk stays loaded, so a well never counts a guard nobody can see.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { GameContext } from '@/game/types';
import { BIOMES } from '@/content/biomes';
import { MonsterGroup } from '@/systems/combat/monsters';
import { stolenColors } from '@/world/paint/stolen';
import { terrainNav } from '@/world/nav/grids';
import { wildMonsterBack } from '@/world/state';
import { chunkKey, type WildChunk } from '@/world/wilderness/chunk';
import { inkWellInChunk, wellGuards } from '@/world/wilderness/ink-wells';
import { chunkSaturation, type WildMonster, wildMonstersInChunk } from '@/world/wilderness/wild-monsters';

export class WildMonsterCamps {
  readonly group: MonsterGroup;
  private readonly release: () => void;
  private readonly chunks = new Map<string, WildChunk>();
  /** The colours each loaded chunk's monsters wear. */
  private readonly colors = new Map<string, readonly number[]>();
  private guardT = 0;
  private readonly blocked = new Set<string>();

  constructor(
    private readonly ctx: GameContext,
    physics: PhysicsWorld,
    root: THREE.Object3D,
    material: THREE.Material,
  ) {
    this.group = new MonsterGroup(ctx, physics, root, material);
    // a monster another player hunted (in a server world) is gone here too
    this.release = ctx.events.on('patch:applied', ({ patch }) => {
      if (patch.kind === 'hunt') this.group.dismiss(patch.monster);
    });
    const n = TUNING.world.chunkSize / TUNING.world.cellSize;
    const height = (ix: number, iz: number): number => {
      const c = this.chunks.get(chunkKey(Math.floor(ix / n), Math.floor(iz / n)));
      if (c) return c.heights[(iz - c.cz * n) * n + (ix - c.cx * n)]!;
      return ctx.wilderness.heightAt((ix + 0.5) * TUNING.world.cellSize, (iz + 0.5) * TUNING.world.cellSize);
    };
    // towns are off limits: their walls and houses are not in the terrain
    const cell = TUNING.world.cellSize;
    this.group.nav = terrainNav(
      height,
      (ix, iz) =>
        this.blocked.has(`${ix},${iz}`) ||
        ctx.wilderness.townAt((ix + 0.5) * cell, (iz + 0.5) * cell) !== null,
    );
  }

  /** Show a loaded chunk's monsters. Returns a function that removes them again. */
  add(chunk: WildChunk): () => void {
    const key = chunkKey(chunk.cx, chunk.cz);
    this.chunks.set(key, chunk);
    const cell = chunk.cell;
    const mine: string[] = [];
    const block = (x: number, z: number): void => {
      const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      this.blocked.add(k);
      mine.push(k);
    };
    for (const t of chunk.trees) block(t.x, t.z);
    for (const r of chunk.ruins)
      for (let dx = -10; dx <= 10; dx += cell)
        for (let dz = -10; dz <= 10; dz += cell) block(r.x + dx, r.z + dz);

    // they wear the land's colours: its pigment sources first, then its ground and trees
    const biome =
      BIOMES[
        this.ctx.wilderness.biomeAt(
          (chunk.cx + 0.5) * TUNING.world.chunkSize,
          (chunk.cz + 0.5) * TUNING.world.chunkSize,
        )
      ]!;
    const colors = stolenColors([
      ...chunk.sources.flatMap((s) => [s.color, s.color, s.color]),
      biome.ground,
      biome.treeColor,
    ]);
    this.colors.set(key, colors);
    const sat = chunkSaturation(this.ctx.wilderness, chunk.cx, chunk.cz, (c) => this.ctx.cities.progress(c));
    const cleansed = this.ctx.state.cleansed.has(`w${chunk.cx}_${chunk.cz}`);
    for (const m of wildMonstersInChunk(this.ctx.wilderness, chunk.cx, chunk.cz, sat, cleansed))
      if (wildMonsterBack(this.ctx.state, m.id)) this.spawn(m, key);
    return () => {
      this.group.clear(key);
      this.chunks.delete(key);
      this.colors.delete(key);
      for (const k of mine) this.blocked.delete(k);
    };
  }

  private spawn(m: WildMonster, key: string): void {
    // none in or right by the arena: it is for players fighting each other
    const arena = this.ctx.arena?.site;
    if (arena && Math.hypot(m.x - arena.x, m.z - arena.z) < arena.radius + 25) return;
    this.group.spawn(m.type, new THREE.Vector3(m.x, m.y + 0.05, m.z), {
      tag: key,
      key: m.id,
      colors: this.colors.get(key) ?? [],
      onDefeat: (byNpc) => {
        // the ink count on the HUD ticks up: no message
        this.ctx.apply({ kind: 'hunt', monster: m.id, ...(byNpc ? { npc: true } : {}) });
      },
    });
  }

  /** Guards whose time away is up come back to their well. */
  private returnGuards(): void {
    for (const [key, chunk] of this.chunks) {
      const well = inkWellInChunk(this.ctx.wilderness, chunk.cx, chunk.cz);
      if (!well || this.ctx.state.cleansed.has(well.id)) continue;
      const sat = chunkSaturation(this.ctx.wilderness, chunk.cx, chunk.cz, (c) =>
        this.ctx.cities.progress(c),
      );
      for (const g of wellGuards(this.ctx.wilderness, well, sat))
        if (wildMonsterBack(this.ctx.state, g.id) && !this.group.has(g.id)) this.spawn(g, key);
    }
  }

  update(dt: number): void {
    this.group.update(dt);
    this.guardT -= dt;
    if (this.guardT <= 0) {
      this.guardT = 3;
      this.returnGuards();
    }
  }

  dispose(): void {
    this.release();
    this.group.dispose();
  }
}

// A city's monsters: the strongholds guarding drained blocks (saved when defeated) and the
// monsters an ink tide brings (gone when the tide ends).
import * as THREE from 'three';
import { ENEMIES, enemyIndex } from '@/content/enemies';
import { TUNING } from '@/content/tuning';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { GameContext } from '@/game/types';
import { MonsterGroup } from '@/systems/combat/monsters';
import { blockBounds, depthFrom } from '@/world/city/blocks';
import { standingMonsters } from '@/world/city/features';
import { ROAD_NONE, type CityLayout } from '@/world/city/layout';
import { cityNav } from '@/world/nav/grids';
import { stolenColors } from '@/world/paint/stolen';

export class CityMonsters {
  readonly group: MonsterGroup;
  private readonly palettes = new Map<number, number[]>();

  constructor(
    private readonly ctx: GameContext,
    private readonly layout: CityLayout,
    private readonly defeated: Uint8Array,
    physics: PhysicsWorld,
    root: THREE.Object3D,
    material: THREE.Material,
  ) {
    this.group = new MonsterGroup(ctx, physics, root, material);
    this.group.nav = cityNav(layout);
    layout.monsters.forEach((m, i) => {
      if (defeated[i]) return;
      this.group.spawn(m.type, new THREE.Vector3(m.x, 0.05, m.z), {
        tag: 'stronghold',
        onDefeat: () => this.defeat(i),
        colors: this.colorsOf(m.chunk),
      });
    });
  }

  /** A block's own colours (what its walls and roofs were before the ink), which its
   * monsters wear: they stole them. */
  private colorsOf(chunk: number): number[] {
    let c = this.palettes.get(chunk);
    if (!c) {
      c = stolenColors(
        this.layout.surfaces.filter((s) => s.chunk === chunk && s.kind !== 'ground').map((s) => s.color),
      );
      this.palettes.set(chunk, c);
    }
    return c;
  }

  private defeat(i: number): void {
    const m = this.layout.monsters[i]!;
    if (!this.ctx.apply({ kind: 'defeat', city: this.layout.id, monster: i }).ok) return;
    const def = ENEMIES[m.type]!;
    this.ctx.events.emit('toast', { text: `打败了${def.name}　墨 +${def.ink}`, seconds: 1.5 });
    if (standingMonsters(this.layout, this.defeated, m.chunk).length === 0)
      this.ctx.events.emit('toast', { text: '这个街区的墨怪都赶走了，可以上色了！', seconds: 4 });
  }

  /** Stronghold monsters still standing in a block. */
  standing(chunk: number): number {
    return standingMonsters(this.layout, this.defeated, chunk).length;
  }

  /** Monsters that come in with a tide, on road cells near the edge it enters through. */
  spawnTide(chunk: number, from: number): void {
    const { n, cell, roads } = this.layout;
    const bounds = blockBounds(chunk, this.layout);
    const spots: THREE.Vector3[] = [];
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) {
        if (roads[iz * n + ix] === ROAD_NONE) continue;
        const x = (ix + 0.5) * cell;
        const z = (iz + 0.5) * cell;
        if (x < bounds.x0 || x >= bounds.x1 || z < bounds.z0 || z >= bounds.z1) continue;
        const depth = depthFrom({ kind: 'ground', chunk, color: 0, area: 0, x, z }, from, bounds);
        if (depth < 18) spots.push(new THREE.Vector3(x, 0.05, z));
      }
    const [lo, hi] = TUNING.combat.tideMonsters;
    const count = lo + Math.floor(Math.random() * (hi - lo + 1));
    for (let k = 0; k < count && spots.length; k++) {
      const spot = spots.splice(Math.floor(Math.random() * spots.length), 1)[0]!;
      // tide monsters come for this block's colour, and already wear it
      this.group.spawn(enemyIndex(Math.random() < TUNING.combat.spitterChance ? 'spitter' : 'blot'), spot, {
        tag: 'tide',
        colors: this.colorsOf(chunk),
      });
    }
  }

  clearTide(): void {
    this.group.clear('tide');
  }

  update(dt: number): void {
    this.group.update(dt);
  }

  dispose(): void {
    this.group.dispose();
  }
}

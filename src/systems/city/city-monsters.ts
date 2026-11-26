// A city's monsters: the strongholds guarding drained blocks (saved when defeated) and the
// monsters an ink tide brings (gone when the tide ends).
import * as THREE from 'three';
import { enemyIndex } from '@/content/enemies';
import { TUNING } from '@/content/tuning';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { GameContext } from '@/game/types';
import { MonsterGroup } from '@/systems/combat/monsters';
import { blockBounds, depthFrom } from '@/world/city/blocks';
import { standingMonsters } from '@/world/city/features';
import { ROAD_NONE, type CityLayout, groundAt } from '@/world/city/layout';
import { cityNav } from '@/world/nav/grids';
import { stolenColors } from '@/world/paint/stolen';
import { ALTAR_GUARDS, liberation } from '@/world/city/liberation';
import { travelAltar } from '@/world/city/travel-altar';

export class CityMonsters {
  readonly group: MonsterGroup;
  private readonly release: () => void;
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
    // a guard another player defeated (in a server world) leaves here too
    this.release = ctx.events.on('patch:applied', ({ patch }) => {
      if (patch.kind === 'defeat' && patch.city === layout.id)
        this.group.dismiss(`stronghold:${patch.monster}`);
      if (patch.kind === 'defeatAltarGuard' && patch.city === layout.id)
        this.group.dismiss(`altar:${patch.guard}`);
    });
    layout.monsters.forEach((m, i) => {
      if (defeated[i]) return;
      this.group.spawn(m.type, new THREE.Vector3(m.x, groundAt(layout, m.x, m.z) + 0.05, m.z), {
        tag: 'stronghold',
        key: `stronghold:${i}`,
        onDefeat: (byNpc) => this.defeat(i, byNpc),
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

  private defeat(i: number, byNpc = false): void {
    const m = this.layout.monsters[i]!;
    if (
      !this.ctx.apply({ kind: 'defeat', city: this.layout.id, monster: i, ...(byNpc ? { npc: true } : {}) })
        .ok
    )
      return;
    // the kill shows itself (colour bursts back, the ink count ticks up): no message
    if (standingMonsters(this.layout, this.defeated, m.chunk).length === 0)
      this.ctx.events.emit('toast', { text: '墨怪赶走了，可以上色了', seconds: 3 });
  }

  /** Stronghold monsters still standing in a block. */
  standing(chunk: number): number {
    return standingMonsters(this.layout, this.defeated, chunk).length;
  }

  /** Monsters that come in with a tide, on road cells near the edge it enters through. */
  spawnTide(chunk: number, from: number, onDefeat: () => void): void {
    const { n, cell, roads, ox, oz } = this.layout;
    const bounds = blockBounds(chunk, this.layout);
    const spots: THREE.Vector3[] = [];
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) {
        if (roads[iz * n + ix] === ROAD_NONE || this.layout.water[iz * n + ix]) continue;
        const x = ox + (ix + 0.5) * cell;
        const z = oz + (iz + 0.5) * cell;
        if (x < bounds.x0 || x >= bounds.x1 || z < bounds.z0 || z >= bounds.z1) continue;
        const depth = depthFrom({ kind: 'ground', chunk, color: 0, area: 0, x, z }, from, bounds);
        if (depth < 18) spots.push(new THREE.Vector3(x, groundAt(this.layout, x, z) + 0.05, z));
      }
    const [lo, hi] = TUNING.combat.tideMonsters;
    const count = lo + Math.floor(Math.random() * (hi - lo + 1));
    const giant = Math.random() < TUNING.combat.giantChance.tide;
    for (let k = 0; k < count && spots.length; k++) {
      const spot = spots.splice(Math.floor(Math.random() * spots.length), 1)[0]!;
      const type =
        giant && k === 0
          ? 'giant'
          : Math.random() < TUNING.combat.spitterChance
            ? 'spitter'
            : Math.random() < TUNING.combat.weaselChance
              ? 'weasel'
              : 'blot';
      // tide monsters come for this block's colour, and already wear it
      this.group.spawn(enemyIndex(type), spot, {
        tag: 'tide',
        onDefeat,
        colors: this.colorsOf(chunk),
      });
    }
  }

  clearTide(): void {
    this.group.clear('tide');
  }

  update(dt: number): void {
    const saved = this.ctx.state.cities.get(this.layout.id);
    if (saved?.completed || saved?.peaceful) {
      this.group.clear('stronghold');
      this.group.clear('altar');
      this.group.clear('tide');
      this.group.update(dt);
      return;
    }
    const altar = travelAltar(this.layout);
    if (saved && altar && liberation(this.layout, saved).unlocked) {
      ALTAR_GUARDS.forEach((type, i) => {
        const bit = 1 << i;
        if ((saved.altarGuards ?? 0) & bit) {
          this.group.dismiss(`altar:${i}`);
          return;
        }
        if (this.group.has(`altar:${i}`)) return;
        const dx = i === 0 ? 0 : i === 1 ? -1.4 : 1.4;
        this.group.spawn(type, new THREE.Vector3(altar.x + dx, altar.y + 0.24, altar.z + (i ? -1 : 0)), {
          tag: 'altar',
          key: `altar:${i}`,
          colors: [0, 1, 3, 4, 7],
          onDefeat: (npc) => {
            const result = this.ctx.apply({
              kind: 'defeatAltarGuard',
              city: this.layout.id,
              guard: i,
              ...(npc ? { npc: true } : {}),
            });
            if (result.ok && liberation(this.layout, saved).captured)
              this.ctx.events.emit('toast', {
                text: '大本营已攻下！回到祭坛，长按 E 修复，全村就能恢复颜色',
                seconds: 6,
              });
          },
        });
      });
    }
    this.group.update(dt);
  }

  dispose(): void {
    this.release();
    this.group.dispose();
  }
}

// Painting studios: one building per city chunk, marked by an orange sign over the door and a
// flag on the front edge of the roof. Press E at the door to refine all held ink into
// pigment (a `refine` patch). The studio nearest the main gate is open from the start; the
// others open once their chunk has colour again.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { BRUSH_TIERS } from '@/content/brush-tiers';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext } from '@/game/types';
import { type CityLayout, groundAt } from '@/world/city/layout';
import { studioOpen } from '@/world/city/features';
import { WindFlags } from '@/engine/render/wind-flags';

export class Studios {
  private readonly mesh: THREE.Mesh;
  private readonly flags: WindFlags;
  private readonly release: (() => void)[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly layout: CityLayout,
    private readonly states: Uint8Array,
    private readonly chunkProgress: (chunk: number) => number,
    material: THREE.Material,
    root: THREE.Object3D,
  ) {
    const g = new GeometryBuilder();
    this.flags = new WindFlags(root, ctx.wilderness.seed);
    const flag = color('orange');
    const pole = color('brown');
    const solid = (c: number) => ({ px: c, nx: c, pz: c, nz: c, py: c, ny: c });
    const always = solid(ALWAYS_COLOR);
    for (const s of layout.studios) {
      const b = layout.buildings[s.building]!;
      // built in the house's own frame (front +z, floor at 0), then turned with it
      const h = new GeometryBuilder();
      const slab = (x: number, z: number, y0: number, y1: number, along: number, across: number, c: number) =>
        h.box(
          { x: x - along / 2, y: y0, z: z - across / 2 },
          { x: x + along / 2, y: y1, z: z + across / 2 },
          solid(c),
          always,
        );
      // sign board over the door, readable from the street
      slab(0, b.hd + 0.2, 2.7, 3.6, 3.4, 0.4, flag);
      // pole and flag on the front edge of the roof, so the roof never hides them
      slab(0, b.hd - 0.4, b.height, b.height + 7, 0.3, 0.3, pole);
      this.flags.add({
        x: b.x + Math.sin(b.angle) * (b.hd - 0.4),
        y: b.base + b.height + 6.8,
        z: b.z + Math.cos(b.angle) * (b.hd - 0.4),
        width: 3.4,
        height: 2.2,
        color: flag,
        phase: b.x * 0.37 + b.z * 0.19,
        surface: ALWAYS_COLOR,
      });
      g.append(h, new THREE.Matrix4().makeRotationY(b.angle).setPosition(b.x, b.base, b.z));
    }
    this.mesh = new THREE.Mesh(g.build(), material);
    root.add(this.mesh);

    const scene = `city:${layout.id}`;
    layout.studios.forEach((s, i) => {
      this.release.push(
        ctx.interactions.add({
          scene,
          pos: new THREE.Vector3(s.door.x, groundAt(layout, s.door.x, s.door.z), s.door.z),
          radius: 3,
          label: () => this.label(i),
          activate: () => this.refine(i),
          alt: { label: () => this.upgradeLabel(i), activate: () => this.upgrade() },
        }),
      );
    });
  }

  update(dt: number): void {
    this.flags.update(dt);
  }

  private label(i: number): string {
    const s = this.layout.studios[i]!;
    if (!studioOpen(this.layout, this.states, i)) {
      const pct = Math.round(this.chunkProgress(s.chunk) * 100);
      const need = Math.round(TUNING.blocks.coloredAt * 100);
      return `画室未开门：街区有色 ${pct}% / ${need}%`;
    }
    const ink = this.ctx.state.inventory.ink;
    const per = TUNING.economy.inkPerGeneric;
    const made = Math.floor(ink / per);
    const stock = this.stock(i);
    if (stock > 0) return `E 画室：领取产出的 ${stock} 份颜料${made > 0 ? `，并提炼墨 ${made * per}` : ''}`;
    return made > 0 ? `E 画室：墨 ${made * per} → 颜料 ${made}` : `画室：墨不够（每 ${per} 墨提炼 1 颜料）`;
  }

  private upgradeLabel(i: number): string | null {
    if (!studioOpen(this.layout, this.states, i)) return null;
    const next = BRUSH_TIERS[this.ctx.state.inventory.brushTier + 1];
    if (!next?.cost) return '笔刷已经是最好的了';
    return `F 升级为${next.name}（颜料 ${next.cost.generic}，墨 ${next.cost.ink}）`;
  }

  private upgrade(): void {
    const r = this.ctx.apply({ kind: 'upgrade', tool: 'brush' });
    const tier = BRUSH_TIERS[this.ctx.state.inventory.brushTier]!;
    this.ctx.events.emit('toast', {
      text: r.ok ? `换上了${tier.name}` : r.reason,
      seconds: r.ok ? 5 : 2.5,
    });
  }

  /** E at a studio: take what a thriving studio has made, then refine held ink. */
  private refine(i: number): void {
    const inv = this.ctx.state.inventory;
    const start = inv.generic;
    const stocked = this.ctx.apply({ kind: 'collectStock', city: this.layout.id, studio: i }).ok;
    const fromStock = inv.generic - start;
    const before = inv.generic;
    const r = this.ctx.apply({ kind: 'refine', city: this.layout.id, studio: i });
    const made = inv.generic - before;
    const parts = [stocked ? `画室产出 ${fromStock}` : '', r.ok ? `提炼出 ${made}` : ''].filter(Boolean);
    const why = r.ok ? '' : r.reason;
    this.ctx.events.emit('toast', { text: parts.length ? `${parts.join('，')} 份颜料` : why });
  }

  /** Generic pigment a thriving studio is holding (for its prompt). */
  private stock(i: number): number {
    const s = this.layout.studios[i]!;
    const from = this.ctx.state.cities.get(this.layout.id)?.stockFrom[s.chunk] ?? -1;
    if (from < 0) return 0;
    const made = Math.floor((this.ctx.state.clock - from) / TUNING.economy.studioStockSeconds);
    return Math.min(TUNING.economy.studioStockCap, made);
  }

  dispose(): void {
    this.flags.dispose();
    for (const r of this.release) r();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}

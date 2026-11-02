// Painting studios: one building per city chunk, marked by an orange sign over the door and a
// flag on the front edge of the roof. Press E at the door to refine all held ink into generic
// pigment (a `refine` patch). The studio nearest the main gate is open from the start; the
// others open once their chunk has colour again.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext } from '@/game/types';
import type { CityLayout } from '@/world/city/layout';
import { doorFront, studioOpen } from '@/world/city/features';

export class Studios {
  private readonly mesh: THREE.Mesh;
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
    const flag = color('orange');
    const pole = color('brown');
    const solid = (c: number) => ({ px: c, nx: c, pz: c, nz: c, py: c, ny: c });
    const always = solid(ALWAYS_COLOR);
    // a box centred on (x, z) spanning `along` metres parallel to the door face and `across` out of it
    const slab = (
      x: number,
      z: number,
      y0: number,
      y1: number,
      along: number,
      across: number,
      c: number,
      alongX: boolean,
    ): void => {
      const [hx, hz] = alongX ? [along / 2, across / 2] : [across / 2, along / 2];
      g.box({ x: x - hx, y: y0, z: z - hz }, { x: x + hx, y: y1, z: z + hz }, solid(c), always);
    };
    for (const s of layout.studios) {
      const b = layout.buildings[s.building]!;
      const alongX = b.doorFace === 'pz' || b.doorFace === 'nz';
      // sign board over the door, readable from the street
      const sign = doorFront(b, 0.2);
      slab(sign.x, sign.z, 2.7, 3.6, 3.4, 0.4, flag, alongX);
      // pole and flag on the front edge of the roof, so the roof never hides them
      const top = doorFront(b, -0.4);
      g.box(
        { x: top.x - 0.15, y: b.height, z: top.z - 0.15 },
        { x: top.x + 0.15, y: b.height + 7, z: top.z + 0.15 },
        solid(pole),
        always,
      );
      const off = 1.8;
      const fx = alongX ? top.x + off : top.x;
      const fz = alongX ? top.z : top.z + off;
      slab(fx, fz, b.height + 4.6, b.height + 6.8, 3.4, 0.12, flag, alongX);
    }
    this.mesh = new THREE.Mesh(g.build(), material);
    root.add(this.mesh);

    const scene = `city:${layout.id}`;
    layout.studios.forEach((s, i) => {
      this.release.push(
        ctx.interactions.add({
          scene,
          pos: new THREE.Vector3(s.door.x, 0, s.door.z),
          radius: 3,
          label: () => this.label(i),
          activate: () => this.refine(i),
        }),
      );
    });
  }

  private label(i: number): string {
    const s = this.layout.studios[i]!;
    if (!studioOpen(this.layout, this.states, i)) {
      const pct = Math.round(this.chunkProgress(s.chunk) * 100);
      const need = Math.round(TUNING.economy.studioOpenRatio * 100);
      return `画室未开门：街区有色 ${pct}% / ${need}%`;
    }
    const ink = this.ctx.state.inventory.ink;
    const per = TUNING.economy.inkPerGeneric;
    const made = Math.floor(ink / per);
    return made > 0
      ? `E 画室：墨 ${made * per} → 通用颜料 ${made}`
      : `画室：墨不够（每 ${per} 墨提炼 1 通用颜料）`;
  }

  private refine(i: number): void {
    const before = this.ctx.state.inventory.generic;
    const r = this.ctx.apply({ kind: 'refine', city: this.layout.id, studio: i });
    const made = this.ctx.state.inventory.generic - before;
    this.ctx.events.emit('toast', { text: r.ok ? `提炼出 ${made} 份通用颜料` : r.reason });
  }

  dispose(): void {
    for (const r of this.release) r();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}

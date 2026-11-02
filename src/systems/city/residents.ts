// Residents with a wish: a small sign in the wanted colour beside their door, and an E prompt
// that shows the wish and hands it in (a `request` patch). A done wish's sign turns cream, so
// a finished street still reads as lived in.
import * as THREE from 'three';
import { PALETTE, color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext } from '@/game/types';
import { recolorWalls } from '@/world/city/features';
import type { CityLayout } from '@/world/city/layout';

export class Residents {
  private readonly signs: THREE.Mesh[] = [];
  private readonly release: (() => void)[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly layout: CityLayout,
    private readonly states: Uint8Array,
    private readonly done: Uint8Array,
    private readonly material: THREE.Material,
    private readonly root: THREE.Object3D,
  ) {
    layout.requests.forEach((r, i) => {
      const mesh = new THREE.Mesh(this.signGeometry(r.door, done[i] ? color('cream') : r.color), material);
      root.add(mesh);
      this.signs.push(mesh);
      this.release.push(
        ctx.interactions.add({
          scene: `city:${layout.id}`,
          pos: new THREE.Vector3(r.door.x, 0, r.door.z),
          radius: 3,
          label: () => this.label(i),
          activate: () => this.handIn(i),
        }),
      );
    });
  }

  private signGeometry(at: { x: number; z: number }, c: number): THREE.BufferGeometry {
    const g = new GeometryBuilder();
    const a = ALWAYS_COLOR;
    const pole = color('brown');
    const f = (v: number) => ({ px: v, nx: v, pz: v, nz: v, py: v, ny: v });
    g.box(
      { x: at.x - 0.05, y: 0, z: at.z - 0.05 },
      { x: at.x + 0.05, y: 1.6, z: at.z + 0.05 },
      f(pole),
      f(a),
    );
    g.box({ x: at.x - 0.4, y: 1.3, z: at.z - 0.06 }, { x: at.x + 0.4, y: 1.9, z: at.z + 0.06 }, f(c), f(a));
    return g.build();
  }

  private label(i: number): string {
    const r = this.layout.requests[i]!;
    if (this.done[i]) return `${r.resident}：谢谢你！`;
    const name = PALETTE[r.color]!.name;
    if (r.kind === 'recolor') {
      const walls = recolorWalls(r, this.states);
      return walls === 4
        ? `E 告诉${r.resident}：房子涂成${name}了`
        : `${r.resident}：“${r.line}”（用涂鸦把四面墙涂成${name}：${walls}/4）`;
    }
    const have = this.ctx.state.inventory.colored[r.color] ?? 0;
    return have >= r.count
      ? `E 把 ${r.count} 份${name}颜料交给${r.resident}`
      : `${r.resident}：“${r.line}”（有 ${have}/${r.count}）`;
  }

  private handIn(i: number): void {
    const r = this.layout.requests[i]!;
    const result = this.ctx.apply({ kind: 'request', city: this.layout.id, request: i });
    if (!result.ok) {
      this.ctx.events.emit('toast', { text: result.reason });
      return;
    }
    const old = this.signs[i]!;
    old.geometry.dispose();
    old.geometry = this.signGeometry(r.door, color('cream'));
    this.ctx.events.emit('toast', { text: `${r.resident}的心愿完成了！通用颜料 +10，墨 +10`, seconds: 4 });
  }

  /** Requests in a block not yet done. */
  open(chunk: number): number {
    return this.layout.requests.filter((r, i) => r.chunk === chunk && !this.done[i]).length;
  }

  /** Where the nearest open request of a block is, for objectives. */
  nearestOpen(chunk: number, from: { x: number; z: number }): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    this.layout.requests.forEach((r, i) => {
      if (r.chunk !== chunk || this.done[i]) return;
      const d = Math.hypot(r.door.x - from.x, r.door.z - from.z);
      if (d < bestD) {
        bestD = d;
        best = r.door;
      }
    });
    return best;
  }

  dispose(): void {
    for (const r of this.release) r();
    for (const s of this.signs) {
      s.geometry.dispose();
      s.removeFromParent();
    }
  }
}

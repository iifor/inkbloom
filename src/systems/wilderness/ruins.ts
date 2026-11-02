// Ruins in loaded chunks: stones in the chunk mesh and colliders, plus a tall crayon in the
// colour the ruin holds, standing until the player walks up to it (a `discover` patch).
import * as THREE from 'three';
import { PALETTE } from '@/content/palette';
import { RUINS } from '@/content/templates';
import { TUNING } from '@/content/tuning';
import type { PhysicsWorld } from '@/engine/physics/world';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext } from '@/game/types';
import { Rng } from '@/world/math/rng';
import type { Ruin } from '@/world/wilderness/ruins';

const solid = (c: number) => ({ px: c, nx: c, pz: c, nz: c, py: c });

/** Stones for a ruin, added to the chunk's geometry and colliders. */
export function buildRuin(r: Ruin, g: GeometryBuilder, physics: PhysicsWorld, group: string): void {
  const tpl = RUINS[r.template]!;
  const rng = new Rng(r.seed);
  const stone = (x: number, z: number, w: number, d: number, h: number): void => {
    const min = { x: r.x + x - w / 2, y: r.y - 0.5, z: r.z + z - d / 2 };
    const max = { x: r.x + x + w / 2, y: r.y + h, z: r.z + z + d / 2 };
    g.box(min, max, solid(tpl.stone));
    physics.addBox(group, min, max);
  };
  if (tpl.shape === 'circle') {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (rng.chance(0.2)) continue; // a fallen stone or two
      stone(Math.cos(a) * 9, Math.sin(a) * 9, 1.4, 1.4, rng.range(2.5, 4.5));
    }
  } else if (tpl.shape === 'bridge') {
    // two piers and a deck that stops short in the middle
    stone(-7, 0, 2.5, 4, 4);
    stone(7, 0, 2.5, 4, 4);
    stone(-4.5, 0, 6, 3.6, 4.6);
    stone(5.5, 0, 4, 3.6, 4.6);
  } else {
    for (let i = 0; i < 7; i++) stone(rng.range(-9, 9), rng.range(-9, 9), 0.7, 1.6, rng.range(1.8, 3.2));
  }
}

export class WildRuins {
  private readonly shown = new Map<string, { ruin: Ruin; mesh: THREE.Mesh }>();
  private checkT = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly material: THREE.Material,
    private readonly root: THREE.Object3D,
  ) {}

  /** Show crayons for a chunk's ruins. Returns a function that removes them. */
  add(ruins: readonly Ruin[]): () => void {
    const ids = ruins.map((r) => {
      const g = new GeometryBuilder();
      const m = new THREE.Matrix4();
      g.mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 3, 6),
        m.makeTranslation(r.x, r.y + 1.5, r.z),
        r.color,
        ALWAYS_COLOR,
      );
      g.mesh(
        new THREE.ConeGeometry(0.35, 0.8, 6),
        m.makeTranslation(r.x, r.y + 3.4, r.z),
        r.color,
        ALWAYS_COLOR,
      );
      const mesh = new THREE.Mesh(g.build(), this.material);
      mesh.visible = !this.ctx.state.discovered.includes(r.id);
      this.root.add(mesh);
      this.shown.set(r.id, { ruin: r, mesh });
      return r.id;
    });
    return () => {
      for (const id of ids) {
        const s = this.shown.get(id);
        s?.mesh.geometry.dispose();
        s?.mesh.removeFromParent();
        this.shown.delete(id);
      }
    };
  }

  update(dt: number): void {
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 0.2;
    const p = this.ctx.player.position;
    for (const { ruin, mesh } of this.shown.values()) {
      if (!mesh.visible) continue;
      if (Math.hypot(p.x - ruin.x, p.z - ruin.z) > TUNING.structures.ruinRadius) continue;
      const knew = this.ctx.state.unlocked.includes(ruin.color);
      if (!this.ctx.apply({ kind: 'discover', ruin: ruin.id }).ok) continue;
      mesh.visible = false;
      for (let k = 0; k < 3; k++)
        this.ctx.events.emit('paint:bloom', {
          at: { x: ruin.x, y: ruin.y + 1 + k, z: ruin.z },
          color: ruin.color,
        });
      const name = PALETTE[ruin.color]!.name;
      const tpl = RUINS[ruin.template]!.name;
      this.ctx.events.emit('toast', {
        text: knew
          ? `在${tpl}找到一支${name}蜡笔：已经有了，换成 ${TUNING.structures.ruinPigment} 份${name}颜料`
          : `在${tpl}找到新颜色：${name}！涂鸦时可以用了`,
        seconds: 5,
      });
    }
  }
}

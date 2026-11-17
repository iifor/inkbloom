// Ruins in loaded chunks: stones in the chunk mesh and colliders, plus a tall crayon in the
// colour the ruin holds, standing until the player walks up to it (a `discover` patch).
import * as THREE from 'three';
import { color, PALETTE } from '@/content/palette';
import { RUINS } from '@/content/templates';
import { TUNING } from '@/content/tuning';
import type { PhysicsWorld } from '@/engine/physics/world';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext } from '@/game/types';
import { hashAt, unit } from '@/world/math/hash';
import { Rng } from '@/world/math/rng';
import type { Ruin } from '@/world/wilderness/ruins';
import { buildCountryHouse } from '../city/country-house';

const solid = (c: number) => ({ px: c, nx: c, pz: c, nz: c, py: c });
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** Stones for a ruin, added to the chunk's geometry and colliders. */
export function buildRuin(r: Ruin, g: GeometryBuilder, physics: PhysicsWorld, group: string): void {
  const tpl = RUINS[r.template]!;
  const rng = new Rng(r.seed);
  let stones = 0;
  /** A stone at (x, z) from the centre, askew unless `turn` sets its yaw. */
  const stone = (x: number, z: number, w: number, d: number, h: number, turn?: number): void => {
    const cx = r.x + x;
    const cz = r.z + z;
    // each stone stands askew; its own hash, so the rng's sizes and places stay as they were
    const askew = unit(hashAt(r.seed, 'ruin-stone', stones++)) * Math.PI;
    const yaw = turn ?? askew;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // on a hillside each stone stands on the lowest ground under its corners, so none hangs in the air
    const g0 = physics.ground;
    let base = g0 ? Infinity : r.y;
    if (g0)
      for (const [lx, lz] of [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [-w / 2, d / 2],
        [w / 2, d / 2],
      ] as const)
        base = Math.min(base, g0(cx + lx * c + lz * s, cz - lx * s + lz * c));
    const min = { x: cx - w / 2, y: base - 0.5, z: cz - d / 2 };
    const max = { x: cx + w / 2, y: base + h, z: cz + d / 2 };
    _m.compose(
      _p.set(cx, (min.y + max.y) / 2, cz),
      _q.setFromAxisAngle(UP, yaw),
      _s.set(w, max.y - min.y, d),
    );
    g.mesh(UNIT_BOX, _m, tpl.stone);
    physics.addBox(group, min, max, {}, yaw);
  };
  if (tpl.shape === 'circle') {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (rng.chance(0.2)) continue; // a fallen stone or two
      stone(Math.cos(a) * 9, Math.sin(a) * 9, 1.4, 1.4, rng.range(2.5, 4.5));
    }
  } else if (tpl.shape === 'bridge') {
    // The two old abutments now carry a bridge keeper's cottage and storehouse.
    // Their foundations follow the hillside; the crayon stands in the open lane.
    for (const barn of [false, true]) {
      const x = r.x + (barn ? 7.1 : -6.6),
        z = r.z + (barn ? -1.1 : 0.7);
      const halfX = barn ? 3.4 : 3.1,
        halfZ = barn ? 2.55 : 2.9;
      const x0 = x - halfX,
        x1 = x + halfX,
        z0 = z - halfZ,
        z1 = z + halfZ;
      const floor = (a: number, b: number) => physics.ground?.(a, b) ?? r.y;
      const samples = [floor(x0, z0), floor(x0, z1), floor(x1, z0), floor(x1, z1), floor(x, z)];
      const base = Math.max(...samples) + 0.08;
      const foot = { x: x0, y: Math.min(...samples) - 0.35, z: z0 },
        top = { x: x1, y: base, z: z1 };
      g.box(foot, top, solid(color('rock')));
      physics.addBox(group, foot, top);
      buildCountryHouse(
        g,
        {
          x0,
          x1,
          z0,
          z1,
          base,
          height: barn ? 3.3 : 3.05,
          front: barn ? 'nx' : 'pz',
          doorAt: barn ? z : x,
          style: barn ? 'barn' : 'cottage',
          plaster: color(barn ? 'sand' : 'limewash'),
          tile: color(barn ? 'slateTile' : 'clayTile'),
          doorColor: color(barn ? 'brown' : 'teal'),
        },
        (min, max) => physics.addBox(group, min, max),
      );
    }
  } else if (tpl.shape === 'shrine') {
    // a stepped platform behind the crayon's open court, pillars at its corners (one or two
    // toppled to stumps), and a broken wall arc around the court
    const back = -6;
    const floor = (a: number, b: number) => physics.ground?.(a, b) ?? r.y;
    let base = r.y;
    for (const [a, b] of [
      [-4, back - 3],
      [4, back - 3],
      [-4, back + 3],
      [4, back + 3],
    ] as const)
      base = Math.max(base, floor(r.x + a, r.z + b));
    for (const [half, top] of [
      [4, 0.45],
      [3, 0.9],
    ] as const) {
      const min = { x: r.x - half, y: base - 1, z: r.z + back - half * 0.75 };
      const max = { x: r.x + half, y: base + top, z: r.z + back + half * 0.75 };
      g.box(min, max, solid(tpl.stone));
      physics.addBox(group, min, max);
    }
    for (const [a, b] of [
      [-2.4, back - 1.6],
      [2.4, back - 1.6],
      [-2.4, back + 1.6],
      [2.4, back + 1.6],
    ] as const)
      stone(a, b, 0.6, 0.6, rng.chance(0.3) ? rng.range(1.2, 1.8) : rng.range(3.4, 4.2));
    for (let i = 0; i < 7; i++) {
      if (rng.chance(0.35)) continue;
      const t = Math.PI * (0.15 + (i / 6) * 0.7);
      stone(Math.cos(t) * 8, Math.sin(t) * 8, 1.6, 0.5, rng.range(0.8, 1.6));
    }
  } else if (tpl.shape === 'waystation') {
    // the stubs of an old waystation's four walls, all turned one way, the doorway towards the
    // crayon; beside it a ring of well stones
    const yaw = rng.range(0, Math.PI);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    /** A wall stub along local x (or z), from the house's own frame into the ruin's. */
    const wall = (u: number, v: number, len: number, alongX: boolean): void => {
      if (rng.chance(0.25)) return; // fallen
      const x = -6 + u * c + v * s;
      const z = -5 - u * s + v * c;
      stone(x, z, alongX ? len : 0.5, alongX ? 0.5 : len, rng.range(0.9, 2.6), yaw);
    };
    for (const u of [-2.6, -1, 1, 2.6]) {
      wall(u, -2.5, 1.5, true);
      if (Math.abs(u) > 2) wall(u, 2.5, 1.5, true); // the doorway gap faces the court
    }
    for (const v of [-1.5, 0, 1.5]) {
      wall(-3.4, v, 1.4, false);
      wall(3.4, v, 1.4, false);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      stone(5 + Math.cos(a) * 1.3, -2 + Math.sin(a) * 1.3, 0.8, 0.45, 0.9, -a);
    }
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
        text: knew ? `颜料 +${TUNING.structures.ruinPigment}` : `在${tpl}找到新颜色：${name}`,
        seconds: 5,
      });
    }
  }
}

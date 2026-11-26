import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { disposeTree } from '@/engine/resources';
import type { GameContext } from '@/game/types';
import { ALTAR_RADIUS, travelAltar } from '@/world/city/travel-altar';
import type { CityLayout } from '@/world/city/layout';
import { cityGroup } from './build-city';
import type { PhysicsWorld } from '@/engine/physics/world';
import { ALTAR_REPAIR_SECONDS, liberation } from '@/world/city/liberation';

/** A low, walkable stone seal with three weathered tablets and a painted blossom compass. */
export class TravelAltar {
  readonly root = new THREE.Group();
  private readonly release: (() => void)[] = [];
  private readonly glyph: THREE.Mesh;
  private readonly motes: THREE.Mesh;
  private charge = 0;
  private time = 0;
  private repair = 0;
  private readonly corruption = new THREE.Group();
  private readonly sealColors: Float32Array;
  private occupied = false;

  constructor(
    private readonly ctx: GameContext,
    private readonly layout: CityLayout,
    physics: PhysicsWorld,
    parent: THREE.Object3D,
  ) {
    const at = travelAltar(layout)!;
    this.root.name = 'travel-altar';
    this.root.position.set(at.x, at.y, at.z);
    const material = makeInkMaterial();
    const g = new GeometryBuilder();
    const m = new THREE.Matrix4();
    const mesh = (geometry: THREE.BufferGeometry, x: number, y: number, z: number, tint: number) => {
      g.meshSmooth(geometry, m.makeTranslation(x, y, z), tint, ALWAYS_COLOR);
      geometry.dispose();
    };
    // Low concentric steps meet sloping paving without a single tall collision ledge.
    for (let tier = 3; tier >= 0; tier--) {
      const radius = ALTAR_RADIUS + tier * 0.25;
      const top = 0.11 - tier * 0.25;
      mesh(new THREE.CylinderGeometry(radius, radius + 0.04, 0.26, 32), 0, top - 0.13, 0, color('rock'));
      for (let i = -4; i <= 4; i++) {
        const z = (i * radius) / 5;
        const halfZ = radius / 10;
        const halfX = Math.sqrt(radius ** 2 - (Math.abs(z) + halfZ) ** 2);
        physics.addBox(
          cityGroup(layout.id),
          { x: at.x - halfX, y: at.y + top - 0.3, z: at.z + z - halfZ },
          { x: at.x + halfX, y: at.y + top, z: at.z + z + halfZ },
        );
      }
    }
    mesh(new THREE.CylinderGeometry(2.12, 2.22, 0.12, 32), 0, 0.15, 0, color('stone'));
    // Boxes stay inside the round plinth; every route onto it is a small step.
    for (let i = -3; i <= 3; i++) {
      const z = i * 0.6;
      const half = Math.sqrt(ALTAR_RADIUS ** 2 - (Math.abs(z) + 0.3) ** 2);
      physics.addBox(
        cityGroup(layout.id),
        { x: at.x - half, y: at.y - 0.5, z: at.z + z - 0.3 },
        { x: at.x + half, y: at.y + 0.21, z: at.z + z + 0.3 },
      );
    }
    for (let i = -1; i <= 1; i++) {
      const a = at.yaw + i * 0.65;
      const x = Math.sin(a) * 2.65,
        z = Math.cos(a) * 2.65;
      const h = i === 0 ? 1.65 : 1.12;
      mesh(new THREE.CylinderGeometry(0.22, 0.34, h, 7), x, h / 2 - 0.12, z, color('rock'));
      mesh(new THREE.SphereGeometry(0.24, 10, 6), x, h - 0.1, z, color('teal'));
      physics.addBox(
        cityGroup(layout.id),
        { x: at.x + x - 0.34, y: at.y - 0.5, z: at.z + z - 0.34 },
        { x: at.x + x + 0.34, y: at.y + h + 0.15, z: at.z + z + 0.34 },
      );
    }
    this.root.add(new THREE.Mesh(g.build(), material));
    const seal = new GeometryBuilder();
    const ring = (r: number, tube: number, x = 0, z = 0, sx = 1, sz = 1, angle = 0) => {
      const geo = new THREE.TorusGeometry(r, tube, 4, 48).rotateX(-Math.PI / 2);
      m.makeRotationY(angle)
        .scale(new THREE.Vector3(sx, 1, sz))
        .setPosition(x, 0.23, z);
      seal.meshSmooth(geo, m, color('cream'), ALWAYS_COLOR);
      geo.dispose();
    };
    ring(1.86, 0.035);
    ring(1.65, 0.018);
    ring(0.25, 0.035);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ring(0.45, 0.03, Math.sin(a) * 0.65, Math.cos(a) * 0.65, 0.48, 1, a);
      const geo = new THREE.OctahedronGeometry(0.09);
      seal.mesh(
        geo,
        m.makeTranslation(Math.sin(a) * 1.75, 0.25, Math.cos(a) * 1.75),
        color('sky'),
        ALWAYS_COLOR,
      );
      geo.dispose();
    }
    this.glyph = new THREE.Mesh(seal.build(), makeInkMaterial({ shadeBias: 0.45 }));
    this.glyph.name = 'altar:seal';
    this.sealColors = new Float32Array(this.glyph.geometry.getAttribute('aColor').array);
    this.corruption.name = 'altar:ink-stronghold';
    const ink = new GeometryBuilder();
    const shard = new THREE.OctahedronGeometry(0.5, 0);
    ink.mesh(shard, new THREE.Matrix4().makeTranslation(0, 3.6, 0), color('ink'), ALWAYS_COLOR);
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.sin(angle) * 1.85, 0.55, Math.cos(angle) * 1.85),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0.3)),
        new THREE.Vector3(0.25, 0.8, 0.25),
      );
      ink.mesh(shard, matrix, color(i % 2 ? 'ink' : 'purple'), ALWAYS_COLOR);
    }
    shard.dispose();
    this.corruption.add(new THREE.Mesh(ink.build(), makeInkMaterial()));
    this.root.add(this.corruption);
    const dust = new GeometryBuilder();
    const particle = new THREE.OctahedronGeometry(0.065);
    for (let i = 0; i < 24; i++) {
      const a = i * 2.39996;
      dust.mesh(
        particle,
        m.makeTranslation(Math.sin(a) * 1.7, (i % 7) * 0.23, Math.cos(a) * 1.7),
        color(i % 3 ? 'cream' : 'sky'),
        ALWAYS_COLOR,
      );
    }
    particle.dispose();
    this.motes = new THREE.Mesh(dust.build(), this.glyph.material);
    this.motes.name = 'altar:charging-motes';
    this.motes.visible = false;
    this.root.add(this.glyph, this.motes);
    parent.add(this.root);
    const action = ctx.scenes.travelAction(layout.id, 'E');
    const recovered = () => {
      const saved = ctx.state.cities.get(layout.id);
      return !!(saved?.completed || saved?.peaceful);
    };
    const progress = () => {
      const saved = ctx.state.cities.get(layout.id);
      return saved ? liberation(layout, saved) : null;
    };
    this.release.push(
      ctx.interactions.add({
        scene: `city:${layout.id}`,
        pos: new THREE.Vector3(at.x, at.y + 0.21, at.z),
        radius: 2.7,
        get holdSeconds() {
          return recovered() ? (action.holdSeconds ?? 2) : ALTAR_REPAIR_SECONDS;
        },
        label: () => {
          if (recovered()) return action.label() ?? '传送祭坛 · 尚未发现其他可用祭坛或墨迹标记';
          const p = progress();
          if (!p?.unlocked)
            return `墨怪大本营 · 先清剿全村 50% 墨怪（${p?.defeated ?? 0}/${p?.required ?? 0}）`;
          if (!p.captured) return `墨怪大本营 · 击败驻守墨巨和护卫（剩 ${p.remaining} 只）`;
          return `长按 E 修复祭坛 · 全村恢复${this.repair > 0 ? ` · ${Math.floor(this.repair * 100)}%` : ''}`;
        },
        canHold: () =>
          recovered()
            ? (action.canHold?.() ?? true)
            : !!(
                progress()?.captured &&
                progress()?.unlocked &&
                ctx.combat.alive &&
                !ctx.combat.infected &&
                ctx.player.grounded &&
                !ctx.player.flying &&
                !ctx.player.gliding &&
                !ctx.player.resting &&
                !ctx.player.gettingUp &&
                ctx.player.waterMode !== 'swimming'
              ),
        onHold: (value) => {
          if (recovered()) {
            this.repair = 0;
            action.onHold?.(value);
          } else this.repair = value;
        },
        activate: () => {
          if (recovered()) action.activate();
          else {
            const result = ctx.apply({ kind: 'restoreAltar', city: layout.id });
            if (!result.ok) ctx.events.emit('toast', { text: result.reason });
            this.repair = 0;
          }
        },
      }),
    );
    this.release.push(
      ctx.events.on('travel:charge', (e) => {
        if (e.from === layout.id) this.charge = e.progress;
      }),
    );
    this.update(0);
  }

  update(dt: number): void {
    this.time += dt;
    const saved = this.ctx.state.cities.get(this.layout.id);
    const occupied = !!saved && !saved.completed && !saved.peaceful;
    if (occupied !== this.occupied) {
      this.occupied = occupied;
      const colors = this.glyph.geometry.getAttribute('aColor') as THREE.BufferAttribute;
      colors.copyArray(occupied ? new Float32Array(colors.count).fill(color('ink')) : this.sealColors);
      colors.needsUpdate = true;
    }
    this.corruption.visible = occupied && !liberation(this.layout, saved!).captured;
    this.corruption.rotation.y = this.time * 0.18;
    this.corruption.position.y = Math.sin(this.time * 2) * 0.08;
    const charge = Math.max(this.charge, this.repair);
    this.motes.visible = charge > 0;
    this.motes.rotation.y = this.time * (0.6 + charge * 1.8);
    this.motes.position.y = 0.3 + charge * 1.2;
    this.motes.scale.setScalar(1 - charge * 0.45);
    this.glyph.scale.setScalar(1 + Math.sin(this.time * 5) * charge * 0.025);
    (this.glyph.material as THREE.ShaderMaterial).uniforms.uShadeBias!.value = 0.05 + charge * 0.7;
  }

  dispose(): void {
    for (const off of this.release) off();
    disposeTree(this.root);
  }
}

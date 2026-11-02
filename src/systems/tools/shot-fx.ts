// What a shot looks like: a short bright streak that flies from the muzzle to where the shot
// landed, and a flash at the muzzle for a few frames. Damage is already done (hits are instant);
// this is only the picture, timed so the eye can follow it. When a streak reaches a wall it
// emits `shot:impact` for the effects and audio to answer.
import * as THREE from 'three';
import type { ShotLook } from '@/content/weapons';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext } from '@/game/types';

const FLASH_TIME = 0.05;
/** Streaks start drawing this far past the muzzle so they never touch the barrel. */
const CLEAR_OF_BARREL = 0.35;
/** Thinnest a streak may look: metres of width per metre from the camera (about 2 px). */
const MIN_ANGULAR_WIDTH = 0.004;
/** A streak is at least this many frames of travel long, so it reads as a line, not dots. */
const MIN_FRAMES_LONG = 1.3;

type Tracer = NonNullable<ShotLook['tracer']>;

interface Streak {
  readonly mesh: THREE.Mesh;
  readonly from: THREE.Vector3;
  readonly dir: THREE.Vector3;
  readonly dist: number;
  readonly look: Tracer;
  readonly impact: boolean;
  head: number;
}

interface Flash {
  readonly mesh: THREE.Mesh;
  t: number;
}

/** A unit streak along +z, centred, in one colour. */
function streakGeometry(c: number): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  const s = { px: c, nx: c, pz: c, nz: c, py: c, ny: c };
  const a = {
    px: ALWAYS_COLOR,
    nx: ALWAYS_COLOR,
    pz: ALWAYS_COLOR,
    nz: ALWAYS_COLOR,
    py: ALWAYS_COLOR,
    ny: ALWAYS_COLOR,
  };
  g.box({ x: -0.5, y: -0.5, z: -0.5 }, { x: 0.5, y: 0.5, z: 0.5 }, s, a);
  return g.build();
}

/** A spiky star facing the camera with a point pushed forward, about 0.1 m across. */
function flashGeometry(core: number, rays: number): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  g.mesh(new THREE.OctahedronGeometry(0.03, 0), new THREE.Matrix4().makeScale(1, 1, 1.6), core, ALWAYS_COLOR);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const len = i % 2 ? 0.05 : 0.075;
    // a thin diamond pointing out from the centre, in the screen plane
    g.mesh(
      new THREE.OctahedronGeometry(1, 0),
      new THREE.Matrix4()
        .makeRotationZ(a)
        .multiply(new THREE.Matrix4().makeTranslation(len * 0.55, 0, 0))
        .multiply(new THREE.Matrix4().makeScale(len * 0.55, 0.012, 0.012)),
      rays,
      ALWAYS_COLOR,
    );
  }
  // the forward tongue of the flame
  g.mesh(
    new THREE.OctahedronGeometry(1, 0),
    new THREE.Matrix4()
      .makeTranslation(0, 0, -0.06)
      .multiply(new THREE.Matrix4().makeScale(0.018, 0.018, 0.07)),
    rays,
    ALWAYS_COLOR,
  );
  return g.build();
}

export class ShotFx {
  private readonly streaks: Streak[] = [];
  private readonly spare = new Map<number, THREE.Mesh[]>();
  private readonly geos = new Map<number, THREE.BufferGeometry>();
  private readonly flashGeo: THREE.BufferGeometry;
  private readonly flashes = new Map<THREE.Object3D, Flash>();
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext,
    private readonly material: THREE.Material,
    flashCore: number,
    flashRays: number,
  ) {
    this.flashGeo = flashGeometry(flashCore, flashRays);
  }

  /** Where the muzzle of a viewmodel is in the world right now. */
  muzzle(view: THREE.Object3D, look: ShotLook): THREE.Vector3 {
    view.updateWorldMatrix(true, false);
    return view.localToWorld(new THREE.Vector3(...look.muzzle));
  }

  /** Flash at the muzzle of a viewmodel. */
  flash(view: THREE.Object3D, look: ShotLook): void {
    if (look.flash <= 0) return;
    let f = this.flashes.get(view);
    if (!f) {
      const mesh = new THREE.Mesh(this.flashGeo, this.material);
      mesh.frustumCulled = false;
      view.add(mesh);
      f = { mesh, t: FLASH_TIME };
      this.flashes.set(view, f);
    }
    f.mesh.position.set(...look.muzzle);
    f.mesh.rotation.set(0, 0, Math.random() * Math.PI * 2);
    f.mesh.scale.setScalar(look.flash * (0.85 + Math.random() * 0.3));
    f.mesh.visible = true;
    f.t = 0;
  }

  /** A streak from the muzzle to where the shot landed. */
  streak(from: THREE.Vector3, to: THREE.Vector3, look: Tracer, impact: boolean): void {
    const dist = from.distanceTo(to);
    if (dist < CLEAR_OF_BARREL + 0.05) {
      if (impact) this.ctx.events.emit('shot:impact', { at: to.clone() });
      return;
    }
    const mesh = this.spare.get(look.color)?.pop() ?? this.newMesh(look.color);
    mesh.visible = false;
    this.streaks.push({
      mesh,
      from: from.clone(),
      dir: to.clone().sub(from).normalize(),
      dist,
      look,
      impact,
      head: CLEAR_OF_BARREL,
    });
  }

  private newMesh(c: number): THREE.Mesh {
    let geo = this.geos.get(c);
    if (!geo) {
      geo = streakGeometry(c);
      this.geos.set(c, geo);
    }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    mesh.userData.color = c;
    this.ctx.renderer.scene.add(mesh);
    return mesh;
  }

  update(dt: number): void {
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i]!;
      const before = s.head;
      s.head += s.look.speed * dt;
      if (before < s.dist && s.head >= s.dist && s.impact)
        this.ctx.events.emit('shot:impact', {
          at: this.v.copy(s.from).addScaledVector(s.dir, s.dist).clone(),
        });
      // the tail keeps going after the head stops at the target, so the streak sinks into it
      const head = Math.min(s.head, s.dist);
      const tail = Math.max(
        CLEAR_OF_BARREL,
        s.head - Math.max(s.look.length, s.look.speed * dt * MIN_FRAMES_LONG),
      );
      if (tail >= s.dist) {
        s.mesh.visible = false;
        const c = s.mesh.userData.color as number;
        const list = this.spare.get(c) ?? [];
        list.push(s.mesh);
        this.spare.set(c, list);
        this.streaks.splice(i, 1);
        continue;
      }
      const len = head - tail;
      s.mesh.position.copy(s.from).addScaledVector(s.dir, (head + tail) / 2);
      s.mesh.lookAt(this.v.copy(s.from).addScaledVector(s.dir, s.dist + 1));
      const far = s.mesh.position.distanceTo(this.ctx.renderer.camera.position);
      const w = Math.max(s.look.width, far * MIN_ANGULAR_WIDTH);
      s.mesh.scale.set(w, w, Math.max(0.01, len));
      s.mesh.visible = true;
    }
    for (const f of this.flashes.values()) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      if (f.t >= FLASH_TIME) f.mesh.visible = false;
      // shrink a little as it burns out
      else f.mesh.scale.multiplyScalar(1 - dt * 6);
    }
  }

  /** Hide everything, e.g. when the weapon is put away. */
  hideFlashes(): void {
    for (const f of this.flashes.values()) f.mesh.visible = false;
  }
}

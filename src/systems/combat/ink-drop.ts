// The ink dropped on death: a puddle with a red flag where the player fell, shown while they
// are in that scene. Walking into it picks the ink back up (a `recover` patch).
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { splatGeometry } from '@/engine/render/soft-shapes';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { WindFlags } from '@/engine/render/wind-flags';
import { type GameContext, type System, sceneKey } from '@/game/types';

export class InkDropSystem implements System {
  readonly id = 'ink-drop';
  private readonly marker: THREE.Mesh;
  private readonly flags: WindFlags;
  private readonly material = makeInkMaterial();

  constructor(private readonly ctx: GameContext) {
    const g = new GeometryBuilder();
    const always = {
      px: ALWAYS_COLOR,
      nx: ALWAYS_COLOR,
      pz: ALWAYS_COLOR,
      nz: ALWAYS_COLOR,
      py: ALWAYS_COLOR,
    };
    const solid = (c: number) => ({ px: c, nx: c, pz: c, nz: c, py: c });
    g.meshSmooth(
      splatGeometry(7, 0.05),
      new THREE.Matrix4().makeScale(1.4, 1, 1.4).setPosition(0, 0.03, 0),
      color('charcoal'),
      ALWAYS_COLOR,
    );
    g.box({ x: -0.06, y: 0, z: -0.06 }, { x: 0.06, y: 3.2, z: 0.06 }, solid(color('brown')), always);
    this.marker = new THREE.Mesh(g.build(), this.material);
    this.flags = new WindFlags(this.marker, ctx.wilderness.seed);
    this.flags.add({
      x: 0,
      y: 3.1,
      z: 0,
      width: 1.04,
      height: 0.8,
      color: color('red'),
      phase: 1.3,
      surface: ALWAYS_COLOR,
    });
    this.marker.visible = false;
    ctx.renderer.scene.add(this.marker);
  }

  update(dt: number): void {
    const drop = this.ctx.state.drop;
    const here =
      drop && this.ctx.combat.alive && sceneKey(drop.scene) === sceneKey(this.ctx.scenes.active.ref);
    this.marker.visible = !!here;
    if (!here || !drop) return;
    this.marker.position.set(drop.x, drop.y, drop.z);
    this.flags.update(dt);
    const p = this.ctx.player.position;
    if (Math.hypot(p.x - drop.x, p.z - drop.z) > TUNING.combat.dropPickupRadius || Math.abs(p.y - drop.y) > 3)
      return;
    const ink = drop.ink;
    if (this.ctx.apply({ kind: 'recover' }).ok) this.ctx.events.emit('toast', { text: `捡回了 ${ink} 墨` });
  }

  dispose(): void {
    this.flags.dispose();
    this.marker.geometry.dispose();
    this.material.dispose();
    this.marker.removeFromParent();
  }
}

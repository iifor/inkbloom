// The rifle: a hitscan tool. Hold the use button to fire, right click to reload (it also reloads
// by itself when empty). Shots go through ctx.combat, so the rifle never needs to know what
// monsters exist. Numbers are in tuning.rifle.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { GameContext } from '@/game/types';
import type { Tool, ToolHud } from './tool';

const R = TUNING.rifle;
const TRACER_TIME = 0.06;

export class Rifle implements Tool {
  readonly id = 'rifle';
  readonly name = '步枪';
  private mag: number = R.magazine;
  private reloading = 0;
  private cooldown = 0;
  private kick = 0;
  private tracerT = 0;
  private readonly material = makeInkMaterial();
  private readonly view: THREE.Mesh;
  private readonly tracer: THREE.Mesh;
  private readonly muzzle = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    const always = {
      px: ALWAYS_COLOR,
      nx: ALWAYS_COLOR,
      pz: ALWAYS_COLOR,
      nz: ALWAYS_COLOR,
      py: ALWAYS_COLOR,
      ny: ALWAYS_COLOR,
    };
    const solid = (c: number) => ({ px: c, nx: c, pz: c, nz: c, py: c, ny: c });
    const g = new GeometryBuilder();
    g.box({ x: -0.04, y: -0.05, z: -0.3 }, { x: 0.04, y: 0.04, z: 0.12 }, solid(color('charcoal')), always);
    g.box(
      { x: -0.018, y: -0.01, z: -0.62 },
      { x: 0.018, y: 0.022, z: -0.3 },
      solid(color('charcoal')),
      always,
    );
    g.box({ x: -0.035, y: -0.16, z: -0.08 }, { x: 0.035, y: -0.05, z: 0.0 }, solid(color('brown')), always);
    g.box({ x: -0.045, y: -0.07, z: 0.12 }, { x: 0.045, y: 0.03, z: 0.3 }, solid(color('brown')), always);
    this.view = new THREE.Mesh(g.build(), this.material);
    this.view.visible = false;
    this.view.frustumCulled = false;
    ctx.renderer.camera.add(this.view);

    const t = new GeometryBuilder();
    t.box({ x: -0.02, y: -0.02, z: -0.5 }, { x: 0.02, y: 0.02, z: 0.5 }, solid(color('charcoal')), always);
    this.tracer = new THREE.Mesh(t.build(), this.material);
    this.tracer.visible = false;
    this.tracer.frustumCulled = false;
    ctx.renderer.scene.add(this.tracer);
  }

  onEquip(): void {
    this.view.visible = true;
  }

  onUnequip(): void {
    this.view.visible = false;
  }

  update(dt: number): void {
    const { input, combat } = this.ctx;
    this.cooldown -= dt;
    this.kick = Math.max(0, this.kick - dt * 8);
    this.tracerT -= dt;
    this.tracer.visible = this.tracerT > 0;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.mag = R.magazine;
    }
    this.pose();
    if (!combat.alive) return;
    if (input.pressed('alt') && this.reloading <= 0 && this.mag < R.magazine)
      this.reloading = R.reloadSeconds;
    if (!input.held('use') || this.cooldown > 0 || this.reloading > 0) return;
    if (this.mag <= 0) {
      this.reloading = R.reloadSeconds;
      return;
    }
    this.fire();
  }

  private fire(): void {
    const { player, combat } = this.ctx;
    this.mag--;
    this.cooldown = R.interval;
    this.kick = 1;
    this.dir
      .copy(player.forward)
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
        ).multiplyScalar(R.spread),
      )
      .normalize();
    const shot = combat.shoot(player.eye, this.dir, R.range, R.damage);
    player.pitch = Math.min(1.5, player.pitch + 0.006);
    // tracer from the muzzle to whatever was hit
    this.muzzle.set(0.22, -0.2, -1.0);
    this.ctx.renderer.camera.localToWorld(this.muzzle);
    const len = this.muzzle.distanceTo(shot.point);
    this.tracer.position.copy(this.muzzle).lerp(shot.point, 0.5);
    this.tracer.lookAt(shot.point);
    this.tracer.scale.set(1, 1, len);
    this.tracerT = TRACER_TIME;
    if (this.mag === 0) this.reloading = R.reloadSeconds;
  }

  private pose(): void {
    const dip = this.reloading > 0 ? Math.sin((1 - this.reloading / R.reloadSeconds) * Math.PI) * 0.18 : 0;
    this.view.position.set(0.22, -0.22 - dip, -0.42 + this.kick * 0.05);
    this.view.rotation.set(this.kick * 0.06 - dip, 0, 0);
  }

  hud(): ToolHud {
    return {
      lines: [`步枪 ${this.mag} / ${R.magazine}`, this.reloading > 0 ? '装弹中…' : '左键射击 · 右键装弹'],
      progress: this.reloading > 0 ? 1 - this.reloading / R.reloadSeconds : null,
      swatch: null,
    };
  }
}

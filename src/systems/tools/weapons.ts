// The weapon slot: every weapon the player owns, one in hand. Q/R or the wheel switches, the
// use button attacks, right click reloads (zooms with the sniper), G uses the weapon's skill.
// Attacks go through ctx.combat (shoot / strike / blast), so weapons never see monsters.
// Weapon numbers live in content/weapons.ts; damage scales with 武器强度, skills with 技能强度.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { WEAPONS, type WeaponDef } from '@/content/weapons';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { GameContext } from '@/game/types';
import { stats } from '@/world/progression';
import { ShotFx } from './shot-fx';
import type { Tool, ToolHud } from './tool';

/** How fast the viewmodel settles after a shot (per second, exponential). */
const RECOIL_RETURN = 16;
/** Most kick that stacks up under sustained fire. */
const RECOIL_MAX = 3;
const SHELL_SPEED = 30;
const SHELL_GRAVITY = 9;
const FIELD = { radius: 4, seconds: 4, tick: 0.5, damage: 18 };
const SHIELD = { amount: 40, seconds: 4 };
const FOCUS = { seconds: 4, multiplier: 1.5 };

interface Held {
  readonly def: WeaponDef;
  readonly view: THREE.Mesh;
  mag: number;
  reloading: number;
  cooldown: number;
  skillT: number;
}

interface Shell {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly radius: number;
  readonly damage: number;
  readonly mesh: THREE.Mesh;
  life: number;
}

interface Field {
  readonly pos: THREE.Vector3;
  readonly mesh: THREE.Mesh;
  readonly damage: number;
  left: number;
  tickT: number;
}

interface Burst {
  readonly mesh: THREE.Mesh;
  readonly radius: number;
  t: number;
}

const always = {
  px: ALWAYS_COLOR,
  nx: ALWAYS_COLOR,
  pz: ALWAYS_COLOR,
  nz: ALWAYS_COLOR,
  py: ALWAYS_COLOR,
  ny: ALWAYS_COLOR,
};
const solid = (c: number) => ({ px: c, nx: c, pz: c, nz: c, py: c, ny: c });

function viewModel(def: WeaponDef): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  const [main, accent] = def.look;
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): void =>
    g.box({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, solid(c), always);
  switch (def.key) {
    case 'katana':
      box(-0.02, -0.02, -0.9, 0.02, 0.05, 0, main); // blade
      box(-0.06, -0.04, 0, 0.06, 0.07, 0.03, accent); // guard
      box(-0.025, -0.03, 0.03, 0.025, 0.04, 0.28, accent); // grip
      break;
    case 'sniper':
      box(-0.035, -0.05, -0.3, 0.035, 0.04, 0.15, main);
      box(-0.014, -0.01, -0.95, 0.014, 0.018, -0.3, main);
      box(-0.03, 0.04, -0.25, 0.03, 0.1, 0.05, accent); // scope
      box(-0.04, -0.07, 0.15, 0.04, 0.03, 0.33, accent);
      break;
    case 'launcher':
      box(-0.08, -0.09, -0.6, 0.08, 0.07, 0.25, main);
      box(-0.03, -0.2, -0.05, 0.03, -0.09, 0.03, accent);
      break;
    case 'staff': {
      box(-0.02, -0.3, -0.25, 0.02, -0.26, 0.45, accent); // shaft, angled by the pose
      g.mesh(
        new THREE.IcosahedronGeometry(0.08, 0),
        new THREE.Matrix4().makeTranslation(0, -0.27, -0.33),
        main,
        ALWAYS_COLOR,
      );
      break;
    }
    default: // rifle
      box(-0.04, -0.05, -0.3, 0.04, 0.04, 0.12, main);
      box(-0.018, -0.01, -0.62, 0.018, 0.022, -0.3, main);
      box(-0.035, -0.16, -0.08, 0.035, -0.05, 0, accent);
      box(-0.045, -0.07, 0.12, 0.045, 0.03, 0.3, accent);
  }
  return g.build();
}

export class WeaponSlot implements Tool {
  readonly id = 'weapons';
  private readonly held = new Map<string, Held>();
  private index = 0;
  private equipped = false;
  private readonly material = makeInkMaterial();
  private readonly fx: ShotFx;
  /** Viewmodel recoil: grows with each shot, settles back; `kickSide` is a small random sway. */
  private kick = 0;
  private kickSide = 0;
  private focusT = 0;
  private readonly shells: Shell[] = [];
  private readonly fields: Field[] = [];
  private readonly bursts: Burst[] = [];
  private readonly shellGeo: THREE.BufferGeometry;
  private readonly burstGeo: THREE.BufferGeometry;
  private readonly fieldGeo: THREE.BufferGeometry;
  private readonly dir = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    this.fx = new ShotFx(ctx, this.material, color('cream'), color('yellow'));
    const s = new GeometryBuilder();
    s.mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.Matrix4(), color('orange'), ALWAYS_COLOR);
    this.shellGeo = s.build();
    const b = new GeometryBuilder();
    b.mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.Matrix4(), color('charcoal'), ALWAYS_COLOR);
    this.burstGeo = b.build();
    const f = new GeometryBuilder();
    f.mesh(new THREE.CylinderGeometry(1, 1, 0.06, 16), new THREE.Matrix4(), color('purple'), ALWAYS_COLOR);
    this.fieldGeo = f.build();
  }

  get name(): string {
    return this.current?.def.name ?? '武器';
  }

  private get current(): Held | undefined {
    const keys = this.ctx.state.inventory.weapons;
    return this.held.get(keys[this.index % Math.max(1, keys.length)] ?? '');
  }

  /** Make sure every owned weapon has its state and viewmodel. */
  private sync(): void {
    for (const key of this.ctx.state.inventory.weapons) {
      if (this.held.has(key)) continue;
      const def = WEAPONS.find((w) => w.key === key);
      if (!def) continue;
      const view = new THREE.Mesh(viewModel(def), this.material);
      view.visible = false;
      view.frustumCulled = false;
      this.ctx.renderer.camera.add(view);
      this.held.set(key, { def, view, mag: def.magazine, reloading: 0, cooldown: 0, skillT: 0 });
    }
  }

  onEquip(): void {
    this.equipped = true;
    this.sync();
    this.show();
  }

  onUnequip(): void {
    this.equipped = false;
    for (const h of this.held.values()) h.view.visible = false;
    this.fx.hideFlashes();
    this.setFov(this.ctx.renderer.baseFov);
  }

  private show(): void {
    const cur = this.current;
    for (const h of this.held.values()) h.view.visible = this.equipped && h === cur;
  }

  private setFov(fov: number): void {
    const cam = this.ctx.renderer.camera;
    if (Math.abs(cam.fov - fov) < 0.01) return;
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }

  /** Runs every frame whether or not the slot is in hand. */
  tick(dt: number): void {
    this.sync();
    for (const h of this.held.values()) {
      h.cooldown -= dt;
      h.skillT = Math.max(0, h.skillT - dt);
      if (h.reloading > 0) {
        h.reloading -= dt;
        if (h.reloading <= 0) h.mag = h.def.magazine;
      }
    }
    this.focusT = Math.max(0, this.focusT - dt);
    const settle = Math.exp(-RECOIL_RETURN * dt);
    this.kick *= settle;
    this.kickSide *= settle;
    this.fx.update(dt);
    this.updateShells(dt);
    this.updateFields(dt);
    this.updateBursts(dt);
  }

  update(): void {
    const { input, combat } = this.ctx;
    const owned = this.ctx.state.inventory.weapons.length;
    const wheel = input.takeWheel();
    if (owned > 1 && (input.pressed('nextColor') || wheel > 0)) this.switch(1);
    if (owned > 1 && (input.pressed('prevColor') || wheel < 0)) this.switch(-1);
    const h = this.current;
    if (!h) return;
    this.pose(h);
    const zoom =
      h.def.key === 'sniper' && input.held('alt') ? 32 : this.focusT > 0 ? 55 : this.ctx.renderer.baseFov;
    this.setFov(zoom);
    if (!combat.alive) return;
    if (input.pressed('skill')) this.skill(h);
    if (
      input.pressed('alt') &&
      h.def.magazine &&
      h.def.key !== 'sniper' &&
      h.reloading <= 0 &&
      h.mag < h.def.magazine
    )
      this.reload(h);
    if (!input.held('use') || h.cooldown > 0 || h.reloading > 0) return;
    if (h.def.magazine && h.mag <= 0) {
      this.reload(h);
      return;
    }
    this.attack(h);
  }

  private reload(h: Held): void {
    h.reloading = h.def.reload;
    this.ctx.events.emit('weapon:reload', { key: h.def.key });
  }

  private switch(step: number): void {
    const n = this.ctx.state.inventory.weapons.length;
    this.index = (((this.index + step) % n) + n) % n;
    this.show();
  }

  private power(): { weapon: number; skill: number } {
    const s = stats(this.ctx.state.growth);
    return { weapon: s.weapon / 100, skill: s.skill / 100 };
  }

  private attack(h: Held): void {
    const { player, combat } = this.ctx;
    const def = h.def;
    h.cooldown = def.interval;
    if (def.magazine) h.mag--;
    this.ctx.events.emit('weapon:fired', { key: def.key });
    const look = def.shot;
    if (look) {
      // snap back at once; tick() eases it home
      this.kick = Math.min(RECOIL_MAX, this.kick + look.recoil);
      this.kickSide = (Math.random() - 0.5) * look.recoil;
      this.fx.flash(h.view, look);
    }
    const dmg = def.damage * this.power().weapon;
    if (def.kind === 'melee') {
      combat.strike(player.eye, player.forward, def.range, def.area, dmg);
      return;
    }
    if (def.kind === 'launcher') {
      this.fireShell(def.area, dmg, h);
      if (h.mag === 0) this.reload(h);
      return;
    }
    const spread = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5,
    ).multiplyScalar(2 * def.spread);
    this.dir.copy(player.forward).add(spread).normalize();
    const focus = def.key === 'sniper' && this.focusT > 0 ? FOCUS.multiplier : 1;
    const shot = combat.shoot(player.eye, this.dir, def.range, dmg * focus);
    player.pitch = Math.min(1.5, player.pitch + (def.key === 'sniper' ? 0.03 : 0.006));
    if (look?.tracer) this.fx.streak(this.fx.muzzle(h.view, look), shot.point, look.tracer, shot.hitWorld);
    if (def.magazine && h.mag === 0) this.reload(h);
  }

  private skill(h: Held): void {
    if (h.skillT > 0) {
      this.ctx.events.emit('toast', {
        text: `${h.def.skill.name}还要 ${Math.ceil(h.skillT)} 秒`,
        seconds: 1,
      });
      return;
    }
    const { player, combat, input } = this.ctx;
    const k = this.power().skill;
    const flat = new THREE.Vector3(player.forward.x, 0, player.forward.z).normalize();
    switch (h.def.key) {
      case 'rifle': {
        // dodge the way the player is moving (backwards if standing still), then a shield
        const right = new THREE.Vector3(-flat.z, 0, flat.x);
        const dir = new THREE.Vector3();
        if (input.held('forward')) dir.add(flat);
        if (input.held('back')) dir.sub(flat);
        if (input.held('right')) dir.add(right);
        if (input.held('left')) dir.sub(right);
        if (dir.lengthSq() < 1e-6) dir.copy(flat).negate();
        player.dash(dir, 6, 0.22);
        combat.shield(SHIELD.amount * k, SHIELD.seconds);
        break;
      }
      case 'katana':
        combat.strike(player.eye, flat, 9, 0.35, 45 * k);
        player.dash(flat, 9, 0.3);
        break;
      case 'sniper':
        this.focusT = FOCUS.seconds;
        break;
      case 'launcher':
        this.fireShell(h.def.area * 2, h.def.damage * 2 * k, h);
        if (h.def.shot) {
          this.kick = RECOIL_MAX;
          this.fx.flash(h.view, { ...h.def.shot, flash: h.def.shot.flash * 1.6 });
        }
        break;
      case 'staff': {
        const hit = this.ctx.scenes.active.physics.raycast(player.eye, player.forward, 40);
        const at = hit ? hit.point : player.eye.clone().addScaledVector(player.forward, 30);
        const mesh = new THREE.Mesh(this.fieldGeo, this.material);
        mesh.position.set(at.x, at.y + 0.05, at.z);
        mesh.scale.set(FIELD.radius, 1, FIELD.radius);
        this.ctx.scenes.active.root.add(mesh);
        this.fields.push({ pos: at.clone(), mesh, damage: FIELD.damage * k, left: FIELD.seconds, tickT: 0 });
        break;
      }
    }
    h.skillT = h.def.skill.cooldown;
    this.ctx.events.emit('weapon:skill', { key: h.def.key });
  }

  private fireShell(radius: number, damage: number, h: Held): void {
    const { player } = this.ctx;
    const from = h.def.shot
      ? this.fx.muzzle(h.view, h.def.shot)
      : this.ctx.renderer.camera.localToWorld(new THREE.Vector3(0.22, -0.2, -1.0));
    const vel = player.forward.clone().multiplyScalar(SHELL_SPEED);
    vel.y += 3;
    const mesh = new THREE.Mesh(this.shellGeo, this.material);
    mesh.position.copy(from);
    mesh.scale.setScalar(radius > 5 ? 1.8 : 1);
    this.ctx.scenes.active.root.add(mesh);
    this.shells.push({ pos: from, vel, radius, damage, mesh, life: 3 });
  }

  private updateShells(dt: number): void {
    const physics = this.ctx.scenes.active.physics;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!;
      s.life -= dt;
      s.vel.y -= SHELL_GRAVITY * dt;
      const step = s.vel.length() * dt;
      this.dir.copy(s.vel).normalize();
      const wall = physics.raycast(s.pos, this.dir, step);
      const next = wall ? wall.point : s.pos.clone().addScaledVector(s.vel, dt);
      // passing within a metre of a target counts as a hit too
      if (wall || this.ctx.combat.probe(next, 1) || s.life <= 0) {
        this.ctx.combat.blast(next, s.radius, s.damage);
        this.burst(next, s.radius);
        s.mesh.removeFromParent();
        this.shells.splice(i, 1);
        continue;
      }
      s.pos.copy(next);
      s.mesh.position.copy(next);
    }
  }

  private updateFields(dt: number): void {
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i]!;
      f.left -= dt;
      f.tickT -= dt;
      if (f.tickT <= 0) {
        f.tickT = FIELD.tick;
        this.ctx.combat.blast(f.pos, FIELD.radius, f.damage);
      }
      f.mesh.scale.set(FIELD.radius, 1 + 0.3 * Math.sin(f.left * 10), FIELD.radius);
      if (f.left <= 0) {
        f.mesh.removeFromParent();
        this.fields.splice(i, 1);
      }
    }
  }

  private burst(at: THREE.Vector3, radius: number): void {
    this.ctx.events.emit('blast', { at, radius });
    const mesh = new THREE.Mesh(this.burstGeo, this.material);
    mesh.position.copy(at);
    this.ctx.scenes.active.root.add(mesh);
    this.bursts.push({ mesh, radius, t: 0 });
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.t += dt;
      const k = b.t / 0.3;
      b.mesh.scale.setScalar(b.radius * Math.min(1, k) * (1 - Math.max(0, k - 0.6)));
      if (k >= 1.2) {
        b.mesh.removeFromParent();
        this.bursts.splice(i, 1);
      }
    }
  }

  private pose(h: Held): void {
    const r =
      h.reloading > 0 && h.def.reload ? Math.sin((1 - h.reloading / h.def.reload) * Math.PI) * 0.18 : 0;
    if (h.def.kind === 'melee') {
      const swing = h.cooldown > 0 ? Math.sin((h.cooldown / h.def.interval) * Math.PI) : 0;
      h.view.position.set(0.3, -0.25, -0.35);
      h.view.rotation.set(-0.4 - swing * 0.8, 0.3 - swing * 1.2, -0.2);
      return;
    }
    // recoil pushes the gun back into the shoulder and tips the muzzle up, with a little sway
    const k = this.kick;
    h.view.position.set(0.22 + this.kickSide * 0.012, -0.22 - r + k * 0.006, -0.42 + k * 0.035);
    h.view.rotation.set(
      k * 0.045 - r + (h.def.key === 'staff' ? 0.5 : 0),
      this.kickSide * 0.02,
      -this.kickSide * 0.03,
    );
  }

  hud(): ToolHud {
    const h = this.current;
    if (!h) return { lines: ['还没有武器'], progress: null, swatch: null };
    const def = h.def;
    const ammo = def.magazine ? ` ${h.mag} / ${def.magazine}` : '';
    const skill =
      h.skillT > 0
        ? `G ${def.skill.name}（${Math.ceil(h.skillT)} 秒）`
        : `G ${def.skill.name}：${def.skill.help}`;
    const owned = this.ctx.state.inventory.weapons.length;
    const zoom = def.key === 'sniper' ? ' · 右键瞄准' : def.magazine ? ' · 右键装弹' : '';
    return {
      lines: [
        `${def.name}${ammo}${h.reloading > 0 ? ' 装弹中…' : ''}`,
        skill,
        `左键攻击${zoom}${owned > 1 ? ` · Q/R 换武器（${owned} 把）` : ''}`,
      ],
      progress: h.reloading > 0 && def.reload ? 1 - h.reloading / def.reload : null,
      swatch: null,
    };
  }
}

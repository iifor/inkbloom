// The weapon slot: every weapon the player owns, one in hand. Q/R or the wheel switches, the
// use button attacks, right click reloads (zooms with the sniper), G uses the weapon's skill.
// Attacks go through ctx.combat (shoot / strike / blast), so weapons never see monsters.
// Weapon numbers live in content/weapons.ts; damage scales with 武器强度, skills with 技能强度.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { WEAPONS, type WeaponDef, type WeaponKey } from '@/content/weapons';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { GameContext } from '@/game/types';
import type { ActKind } from '@/world/net/protocol';
import { stats } from '@/world/progression';
import { defaultLook, type Look } from '@/content/characters';
import { ShotFx } from './shot-fx';
import { type Hands, handsOf, viewModel } from './viewmodels';
import type { InHand, Tool, ToolHud } from './tool';

/** How fast the viewmodel settles after a shot (per second, exponential). */
const RECOIL_RETURN = 16;
/** Most kick that stacks up under sustained fire. */
const RECOIL_MAX = 3;
const SHELL_SPEED = 30;
const SHELL_GRAVITY = 9;
const FIELD = { radius: 4, seconds: 4, tick: 0.5, damage: 18 };
const SHIELD = { amount: 40, seconds: 4 };
const FOCUS = { seconds: 4, multiplier: 1.5 };
const FEEL = TUNING.combat.feel;
/** In the arena everyone has every weapon. */
const ALL: readonly WeaponKey[] = WEAPONS.map((w) => w.key);
/** Seconds the katana's slash arc shows. */
const SLASH_TIME = 0.13;
/** How far the weapon lags behind a turn of the view (per radian per second), and its limit. */
const SWAY = 0.012;
const SWAY_MAX = 0.05;

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
  /** Someone else's, in the arena: drawn only (the server works out its hits). */
  readonly seen?: boolean;
}

interface Field {
  readonly pos: THREE.Vector3;
  readonly mesh: THREE.Mesh;
  readonly damage: number;
  left: number;
  tickT: number;
  readonly seen?: boolean;
}

interface Burst {
  readonly mesh: THREE.Mesh;
  readonly radius: number;
  t: number;
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
  /** Hitstop: the held weapon holds its pose for a moment after a heavy hit. */
  private stopT = 0;
  /** Weight in hand: the weapon bobs with the player's steps and lags behind turns of the view. */
  private bobPhase = 0;
  private bobAmt = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  /** The katana's slash: a pale arc sweeping across the view for a moment. */
  private readonly slashMesh: THREE.Mesh;
  private slashT = 0;
  private readonly shells: Shell[] = [];
  private readonly fields: Field[] = [];
  private readonly bursts: Burst[] = [];
  private readonly shellGeo: THREE.BufferGeometry;
  private readonly burstGeo: THREE.BufferGeometry;
  private readonly fieldGeo: THREE.BufferGeometry;
  private readonly dir = new THREE.Vector3();
  /** Whether the last frame was in the arena (going in or out rearms every weapon). */
  private wasInArena = false;
  /** The hands holding the weapons: the player's skin and coat. */
  private hands: Hands = handsOf(defaultLook('courier'));
  /** Held weapons are painted like the people: brush strokes on every part. */
  private readonly viewMaterial = makeInkMaterial({ cloth: true });

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
    ctx.events.on('shot:hit', ({ heavy }) => {
      if (heavy) this.stopT = FEEL.hitstop;
    });
    const a = new GeometryBuilder();
    a.meshSmooth(
      new THREE.RingGeometry(0.36, 0.4, 24, 1, Math.PI * 0.2, Math.PI * 0.6),
      new THREE.Matrix4(),
      color('cream'),
      ALWAYS_COLOR,
    );
    this.slashMesh = new THREE.Mesh(a.build(), this.material);
    this.slashMesh.position.set(0.08, -0.12, -0.9);
    this.slashMesh.visible = false;
    this.slashMesh.frustumCulled = false;
    ctx.renderer.camera.add(this.slashMesh);
  }

  get name(): string {
    return this.current?.def.name ?? '武器';
  }

  /** The weapons in hand's reach: the player's own, or all of them in the arena. */
  private get owned(): readonly string[] {
    return this.ctx.arena?.inside ? ALL : this.ctx.state.inventory.weapons;
  }

  private get current(): Held | undefined {
    const keys = this.owned;
    return this.held.get(keys[this.index % Math.max(1, keys.length)] ?? '');
  }

  /** Make sure every owned weapon has its state and viewmodel. */
  private sync(): void {
    for (const key of this.owned) {
      if (this.held.has(key)) continue;
      const def = WEAPONS.find((w) => w.key === key);
      if (!def) continue;
      const view = new THREE.Mesh(viewModel(def, this.hands), this.viewMaterial);
      view.visible = false;
      view.frustumCulled = false;
      this.ctx.renderer.camera.add(view);
      this.held.set(key, { def, view, mag: def.magazine, reloading: 0, cooldown: 0, skillT: 0 });
    }
  }

  /** The player's character changed: their own hands and sleeves on every weapon. */
  setLook(look: Look): void {
    this.hands = handsOf(look);
    for (const h of this.held.values()) {
      h.view.geometry.dispose();
      h.view.geometry = viewModel(h.def, this.hands);
    }
  }

  onEquip(): void {
    this.equipped = true;
    this.sync();
    this.show();
    this.ctx.events.emit('toast', {
      text: '左键攻击 · 右键装弹或瞄准 · Q/R 换武器 · G 技能',
      seconds: 5,
      once: 'weapon-use',
    });
    const h = this.current;
    if (h)
      this.ctx.events.emit('toast', {
        text: `G ${h.def.skill.name}：${h.def.skill.help}`,
        seconds: 5,
        once: `skill:${h.def.key}`,
      });
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
    const inArena = this.ctx.arena?.inside ?? false;
    if (inArena !== this.wasInArena) {
      this.wasInArena = inArena;
      this.sync();
      // a fair start: full magazines, every skill ready
      for (const h of this.held.values())
        Object.assign(h, { mag: h.def.magazine, reloading: 0, cooldown: 0, skillT: 0 });
      this.show();
    }
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
    this.stopT -= dt;
    this.feel(dt);
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
    const owned = this.owned.length;
    const wheel = input.takeWheel();
    if (owned > 1 && (input.pressed('nextColor') || wheel > 0)) this.switch(1);
    if (owned > 1 && (input.pressed('prevColor') || wheel < 0)) this.switch(-1);
    const h = this.current;
    if (!h) return;
    if (this.stopT <= 0) this.pose(h);
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
    if (input.pressed('use') && h.reloading > 0) this.ctx.events.emit('weapon:dry', { key: h.def.key });
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
    const n = this.owned.length;
    this.index = (((this.index + step) % n) + n) % n;
    this.show();
    const h = this.current;
    if (h) this.ctx.events.emit('equip', { key: h.def.key });
    if (h)
      this.ctx.events.emit('toast', {
        text: `G ${h.def.skill.name}：${h.def.skill.help}`,
        seconds: 5,
        once: `skill:${h.def.key}`,
      });
  }

  /** Another player's attack in the arena, drawn as if it were fired here: the streak of a
   * shot, a shell's flight and burst, an ink circle. It hurts nothing (the server decides). */
  seen(w: WeaponKey, k: ActKind, o: THREE.Vector3, d: THREE.Vector3): void {
    const def: WeaponDef = WEAPONS.find((x) => x.key === w)!;
    switch (k) {
      case 'shot': {
        const tracer = def.shot?.tracer;
        if (!tracer) return;
        const wall = this.ctx.scenes.active.physics.raycast(o, d, def.range);
        const end = o.clone().addScaledVector(d, wall?.dist ?? def.range);
        this.fx.streak(o, end, tracer, wall !== null);
        break;
      }
      case 'shell':
      case 'bigshell': {
        const big = k === 'bigshell';
        const vel = d.clone().multiplyScalar(SHELL_SPEED);
        vel.y += 3;
        const mesh = new THREE.Mesh(this.shellGeo, this.material);
        mesh.position.copy(o);
        mesh.scale.setScalar(big ? 1.8 : 1);
        this.ctx.scenes.active.root.add(mesh);
        this.shells.push({
          pos: o.clone(),
          vel,
          radius: def.area * (big ? 2 : 1),
          damage: 0,
          mesh,
          life: 3,
          seen: true,
        });
        break;
      }
      case 'field': {
        const mesh = new THREE.Mesh(this.fieldGeo, this.material);
        mesh.position.set(o.x, o.y + 0.05, o.z);
        mesh.scale.set(FIELD.radius, 1, FIELD.radius);
        this.ctx.scenes.active.root.add(mesh);
        this.fields.push({ pos: o.clone(), mesh, damage: 0, left: FIELD.seconds, tickT: 0, seen: true });
        break;
      }
      default:
        break;
    }
  }

  /** In the arena: the server works out what this attack or skill hits. */
  private tell(w: WeaponKey, k: ActKind, o: THREE.Vector3, d: THREE.Vector3): void {
    if (this.ctx.arena?.inside) this.ctx.arena.act(w, k, o, d);
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
      this.tell(def.key as WeaponKey, 'strike', player.eye, player.forward);
      combat.strike(player.eye, player.forward, def.range, def.area, dmg);
      this.slashT = SLASH_TIME;
      return;
    }
    if (def.kind === 'launcher') {
      this.fireShell(def.area, dmg, h, 'shell');
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
    this.tell(def.key as WeaponKey, 'shot', player.eye, this.dir);
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
        this.tell('rifle', 'shield', player.eye, player.forward);
        combat.shield(SHIELD.amount * k, SHIELD.seconds);
        break;
      }
      case 'katana':
        this.tell('katana', 'slash', player.eye, flat);
        combat.strike(player.eye, flat, 9, 0.35, 45 * k);
        player.dash(flat, 9, 0.3);
        this.slashT = SLASH_TIME;
        break;
      case 'sniper':
        this.tell('sniper', 'focus', player.eye, player.forward);
        this.focusT = FOCUS.seconds;
        break;
      case 'launcher':
        this.fireShell(h.def.area * 2, h.def.damage * 2 * k, h, 'bigshell');
        if (h.def.shot) {
          this.kick = RECOIL_MAX;
          this.fx.flash(h.view, { ...h.def.shot, flash: h.def.shot.flash * 1.6 });
        }
        break;
      case 'staff': {
        const hit = this.ctx.scenes.active.physics.raycast(player.eye, player.forward, 40);
        const at = hit ? hit.point : player.eye.clone().addScaledVector(player.forward, 30);
        this.tell('staff', 'field', at, player.forward);
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

  private fireShell(radius: number, damage: number, h: Held, kind: 'shell' | 'bigshell'): void {
    const { player } = this.ctx;
    const from = h.def.shot
      ? this.fx.muzzle(h.view, h.def.shot)
      : this.ctx.renderer.camera.localToWorld(new THREE.Vector3(0.22, -0.2, -1.0));
    this.tell('launcher', kind, from, player.forward);
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
      if (wall || (!s.seen && this.ctx.combat.probe(next, 1)) || s.life <= 0) {
        if (!s.seen) this.ctx.combat.blast(next, s.radius, s.damage, FEEL.knockBlast);
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
        if (!f.seen) this.ctx.combat.blast(f.pos, FIELD.radius, f.damage);
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
      // a swing snaps across in the first moment, then the blade eases back to rest
      const t = h.cooldown > 0 ? 1 - h.cooldown / h.def.interval : 1;
      const swing = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.6) ** 2;
      h.view.position.set(0.3 - swing * 0.12, -0.25 + swing * 0.03, -0.35 - swing * 0.08);
      h.view.rotation.set(-0.4 - swing * 1.1, 0.3 - swing * 1.5, -0.2 - swing * 0.5);
      this.weigh(h);
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
    this.weigh(h);
  }

  /** Step bob and look sway on top of the weapon's pose. */
  private weigh(h: Held): void {
    const b = this.bobAmt;
    h.view.position.x += this.swayX + Math.cos(this.bobPhase) * 0.008 * b;
    h.view.position.y += this.swayY - Math.abs(Math.sin(this.bobPhase)) * 0.012 * b;
    h.view.rotation.z += this.swayX * 0.6;
  }

  /** Track steps and turns for the weapon's bob and sway; play out the slash arc. */
  private feel(dt: number): void {
    const { player } = this.ctx;
    const pace = player.grounded ? Math.min(1.6, player.speed / 6) : 0;
    this.bobAmt = THREE.MathUtils.damp(this.bobAmt, pace, 10, dt);
    this.bobPhase += dt * (5.5 + 3 * Math.max(0, pace - 1)) * Math.min(1, pace * 2);
    if (dt > 0) {
      const turn = Math.atan2(Math.sin(player.yaw - this.lastYaw), Math.cos(player.yaw - this.lastYaw)) / dt;
      const tilt = (player.pitch - this.lastPitch) / dt;
      const clamp = (v: number): number => THREE.MathUtils.clamp(v, -SWAY_MAX, SWAY_MAX);
      // the weapon trails the turn: turning right leaves it a little to the left
      this.swayX = THREE.MathUtils.damp(this.swayX, clamp(turn * SWAY), 14, dt);
      this.swayY = THREE.MathUtils.damp(this.swayY, clamp(-tilt * SWAY), 14, dt);
    }
    this.lastYaw = player.yaw;
    this.lastPitch = player.pitch;
    this.slashT -= dt;
    const on = this.slashT > 0 && this.equipped;
    this.slashMesh.visible = on;
    if (on) {
      // the arc sweeps from upper right to lower left and widens as it goes
      const k = 1 - this.slashT / SLASH_TIME;
      this.slashMesh.rotation.set(0, 0, 0.9 - k * 1.5);
      this.slashMesh.scale.setScalar(0.9 + k * 0.25);
    }
  }

  inHand(): InHand {
    const key = this.current?.def.key as WeaponKey | undefined;
    if (!key) return { item: null, aiming: false, painting: false };
    // the sniper's scope, or 专注射击's steadied aim
    const aiming = key === 'sniper' && (this.ctx.input.held('alt') || this.focusT > 0);
    return { item: key, aiming, painting: false };
  }

  hud(): ToolHud {
    const h = this.current;
    if (!h) return { lines: ['还没有武器'], progress: null, swatch: null };
    const def = h.def;
    const ammo = def.magazine ? ` ${h.mag} / ${def.magazine}` : '';
    // what it is and what is left; how to use it is a lesson on first equip (see onEquip)
    const cooling = h.skillT > 0 ? `${def.skill.name} ${Math.ceil(h.skillT)} 秒` : '';
    return {
      lines: [`${def.name}${ammo}${h.reloading > 0 ? ' 装弹中…' : ''}`, cooling].filter(Boolean),
      progress: h.reloading > 0 && def.reload ? 1 - h.reloading / def.reload : null,
      swatch: null,
    };
  }
}

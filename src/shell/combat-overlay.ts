// Damage you can see: numbers floating off monsters you hit, a health bar over a monster for
// a few seconds after each hit, and for hits you take a red number by the health bar plus an
// arrow at the screen edge pointing where it came from. Plain DOM over the canvas, positions
// projected from the world each frame. Listens to events only.
import * as THREE from 'three';
import type { Point3 } from '@/game/events';
import type { GameContext, System } from '@/game/types';

const NUMBER_LIFE = 0.9;
const BAR_LIFE = 3;
const ARROW_LIFE = 1.1;
/** Hits at least this big get the large gold style. */
const BIG_HIT = 50;
/** Beyond this distance numbers and bars are not drawn. */
const MAX_DIST = 70;

interface Floater {
  readonly el: HTMLElement;
  readonly at: THREE.Vector3;
  t: number;
  readonly drift: number;
}

interface Bar {
  readonly el: HTMLElement;
  readonly fill: HTMLElement;
  readonly anchor: Point3;
  readonly height: number;
  t: number;
}

interface Arrow {
  readonly el: HTMLElement;
  readonly from: Point3;
  t: number;
}

export class CombatOverlay implements System {
  readonly id = 'combat-overlay';
  private readonly root: HTMLElement;
  private readonly floaters: Floater[] = [];
  private readonly bars = new Map<number, Bar>();
  private readonly arrows: Arrow[] = [];
  private readonly release: (() => void)[] = [];
  private readonly v = new THREE.Vector3();
  private readonly top = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext,
    parent: HTMLElement,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'combat-overlay';
    parent.append(this.root);
    const on = ctx.events.on.bind(ctx.events);
    this.release.push(
      on('monster:hit', (e) => {
        this.number(e.at, e.amount, e.amount >= BIG_HIT ? 'big' : '');
        this.bar(e.id, e.anchor, e.height, e.hp);
      }),
      on('monster:died', (e) => {
        this.number(e.at, e.amount, 'kill');
        this.dropBar(e.id);
      }),
      on('player:hurt', (e) => {
        // health damage left of centre, shield damage right, so both stay readable
        if (e.amount > 0) this.selfNumber(`-${Math.round(e.amount)}`, 'hurt', -45);
        if (e.absorbed > 0) this.selfNumber(`-${Math.round(e.absorbed)} 护盾`, 'shield', 55);
        if (e.from) this.arrow(e.from);
      }),
      // a new scene has different monsters
      on('scene:entered', () => this.clear()),
    );
  }

  private number(at: Point3, amount: number, style: string): void {
    const el = document.createElement('div');
    el.className = `dmg ${style}`;
    el.textContent = String(Math.max(1, Math.round(amount)));
    this.root.append(el);
    this.floaters.push({
      el,
      at: new THREE.Vector3(at.x, at.y + 0.4, at.z),
      t: 0,
      drift: (Math.random() - 0.5) * 30,
    });
  }

  private bar(id: number, anchor: Point3, height: number, hp: number): void {
    let b = this.bars.get(id);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'mbar';
      const fill = document.createElement('i');
      el.append(fill);
      this.root.append(el);
      b = { el, fill, anchor, height, t: 0 };
      this.bars.set(id, b);
    }
    b.t = 0;
    b.fill.style.width = `${Math.max(0, Math.min(1, hp)) * 100}%`;
    b.el.classList.toggle('low', hp < 0.3);
  }

  private dropBar(id: number): void {
    this.bars.get(id)?.el.remove();
    this.bars.delete(id);
  }

  private selfNumber(text: string, style: string, offset: number): void {
    const el = document.createElement('div');
    el.className = `selfdmg ${style}`;
    el.textContent = text;
    el.style.left = `calc(50% + ${Math.round(offset + (Math.random() - 0.5) * 24)}px)`;
    this.root.append(el);
    setTimeout(() => el.remove(), 900);
  }

  private arrow(from: Point3): void {
    const el = document.createElement('div');
    el.className = 'hurt-arrow';
    this.root.append(el);
    this.arrows.push({ el, from, t: 0 });
  }

  /** World point to CSS pixels, or null when behind the camera or too far away. */
  private project(p: THREE.Vector3): { x: number; y: number } | null {
    const cam = this.ctx.renderer.camera;
    if (p.distanceTo(cam.position) > MAX_DIST) return null;
    this.v.copy(p).project(cam);
    if (this.v.z > 1 || this.v.z < -1) return null;
    const el = this.ctx.renderer.renderer.domElement;
    return { x: ((this.v.x + 1) / 2) * el.clientWidth, y: ((1 - this.v.y) / 2) * el.clientHeight };
  }

  update(dt: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.t += dt;
      if (f.t >= NUMBER_LIFE) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const s = this.project(f.at);
      if (!s) {
        f.el.style.opacity = '0';
        continue;
      }
      const k = f.t / NUMBER_LIFE;
      f.el.style.opacity = String(1 - k * k);
      f.el.style.transform = `translate(${s.x + f.drift * k}px, ${s.y - 40 * k}px) translate(-50%, -50%)`;
    }
    for (const [id, b] of this.bars) {
      b.t += dt;
      if (b.t >= BAR_LIFE) {
        this.dropBar(id);
        continue;
      }
      const s = this.project(this.top.set(b.anchor.x, b.anchor.y + b.height + 0.35, b.anchor.z));
      b.el.style.opacity = s ? String(Math.min(1, (BAR_LIFE - b.t) * 2)) : '0';
      if (s) b.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
    }
    const { player } = this.ctx;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i]!;
      a.t += dt;
      if (a.t >= ARROW_LIFE) {
        a.el.remove();
        this.arrows.splice(i, 1);
        continue;
      }
      // bearing of the attacker relative to where the player looks: 0 ahead, positive to the left
      const toward = Math.atan2(-(a.from.x - player.position.x), -(a.from.z - player.position.z));
      const rel = toward - player.yaw;
      a.el.style.opacity = String(1 - a.t / ARROW_LIFE);
      a.el.style.transform = `translate(-50%, -50%) rotate(${-rel}rad) translateY(-140px)`;
    }
  }

  private clear(): void {
    for (const f of this.floaters) f.el.remove();
    for (const b of this.bars.values()) b.el.remove();
    for (const a of this.arrows) a.el.remove();
    this.floaters.length = 0;
    this.bars.clear();
    this.arrows.length = 0;
  }

  dispose(): void {
    for (const r of this.release) r();
    this.root.remove();
  }
}

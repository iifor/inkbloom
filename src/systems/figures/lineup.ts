// Development only: the four player characters and both monsters standing in a row in front of
// the camera, acting out their poses, so the figures can be looked at in the real renderer
// (light, shadow, brush pass, drained areas) before players and multiplayer exist. Driven from
// `window.inkbloom.lineup()` in shell/dev-tools.ts; nothing in the game creates one.
import * as THREE from 'three';
import { CHARACTERS, defaultLook } from '@/content/characters';
import { ENEMIES } from '@/content/enemies';
import { color } from '@/content/palette';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { GameContext } from '@/game/types';
import { MonsterFigures } from '@/systems/combat/monster-figure';
import { PlayerFigures } from './player-figure';

export type LineupAct = 'cycle' | 'idle' | 'walk' | 'run' | 'air' | 'glide' | 'attack' | 'hurt' | 'dying';

const CYCLE: readonly LineupAct[] = ['idle', 'walk', 'run', 'attack', 'air', 'glide', 'hurt', 'dying'];
/** Seconds each act lasts while cycling. */
const ACT_SECONDS = 2.5;
const SPACING = 1.7;
const DISTANCE = 6;

interface Slot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  walk: number;
}

export class FigureLineup {
  private readonly group = new THREE.Group();
  private readonly material = makeInkMaterial();
  private readonly players = new PlayerFigures(this.group, this.material);
  private readonly monsters = new MonsterFigures(this.group, this.material);
  private slots: Slot[] = [];
  private t = 0;
  act: LineupAct = 'cycle';

  constructor(private readonly ctx: GameContext) {}

  /** Stand the row up in front of the player, facing them. */
  place(): void {
    const p = this.ctx.player.position;
    const f = this.ctx.player.forward;
    const fwd = new THREE.Vector3(f.x, 0, f.z).normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const centre = p.clone().addScaledVector(fwd, DISTANCE);
    const n = CHARACTERS.length + 2;
    this.slots = Array.from({ length: n }, (_, i) => {
      const at = centre.clone().addScaledVector(side, (i - (n - 1) / 2) * SPACING);
      return { x: at.x, z: at.z, yaw: Math.atan2(-(p.x - at.x), -(p.z - at.z)), walk: i };
    });
  }

  private groundAt(x: number, z: number): number {
    return this.ctx.scenes.active.ref.kind === 'wild' ? this.ctx.wilderness.heightAt(x, z) : 0;
  }

  update(dt: number): void {
    const root = this.ctx.scenes.active.root;
    if (this.group.parent !== root) root.add(this.group);
    this.t += dt;
    const n = this.slots.length;
    this.players.begin();
    this.monsters.begin();
    this.slots.forEach((s, i) => {
      // while cycling, neighbours are a step apart so every act is on show at once
      const act =
        this.act === 'cycle' ? CYCLE[(Math.floor(this.t / ACT_SECONDS) + i) % CYCLE.length]! : this.act;
      const phase = (this.t % ACT_SECONDS) / ACT_SECONDS;
      const stride = act === 'walk' ? 1 : act === 'run' ? 1.7 : 0;
      s.walk += dt * (stride > 1 ? 9 : 6) * Math.min(1, stride);
      const air = act === 'air' || act === 'glide';
      const y =
        this.groundAt(s.x, s.z) +
        (act === 'air' ? Math.sin(phase * Math.PI) * 0.9 : act === 'glide' ? 1.2 : 0);
      const hurt = act === 'hurt' ? Math.max(0, 1 - ((phase * 3) % 1) * 4) : 0;
      const dying = act === 'dying' ? Math.min(1, phase * 1.4) : -1;
      if (i === 0 || i === n - 1) {
        const def = ENEMIES[i === 0 ? 0 : 1]!;
        this.monsters.draw(def, {
          x: s.x,
          y: act === 'glide' ? y - 1.2 : y,
          z: s.z,
          yaw: s.yaw,
          walk: s.walk,
          stride: Math.min(1, stride),
          attack: act === 'attack' ? (phase * 2) % 1 : -1,
          hurt,
          air,
          dying,
          t: this.t,
          colors: i === 0 ? [color('red'), color('yellow')] : [color('yellow'), color('blue')],
        });
      } else {
        this.players.draw(defaultLook(CHARACTERS[i - 1]!.key), {
          x: s.x,
          y,
          z: s.z,
          yaw: s.yaw,
          pitch: act === 'idle' ? Math.sin(this.t * 0.8) * 0.4 : 0,
          walk: s.walk,
          stride,
          air: act === 'air',
          glide: act === 'glide',
          hurt,
          dying,
          t: this.t,
        });
      }
    });
    this.players.end();
    this.monsters.end();
  }

  dispose(): void {
    this.players.dispose();
    this.monsters.dispose();
    this.group.removeFromParent();
    this.material.dispose();
  }
}

// Development only: the four player characters and both monsters standing in a row in front of
// the camera, acting out their poses, so the figures can be looked at in the real renderer
// (light, shadow, brush pass, drained areas) before players and multiplayer exist. Driven from
// `window.inkbloom.lineup()` in shell/dev-tools.ts; nothing in the game creates one.
//
// The hand acts (brush, slash, shoot...) show what other players' figures do with what they
// hold; in 'attack' each character uses a different one.
import * as THREE from 'three';
import { CHARACTERS, defaultLook } from '@/content/characters';
import { ENEMIES } from '@/content/enemies';
import { color } from '@/content/palette';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { GameContext } from '@/game/types';
import { MonsterFigures } from '@/systems/combat/monster-figure';
import type { Gesture, HeldItem } from '@/world/net/protocol';
import { ACTION_SECONDS, type PlayerPose, PlayerFigures } from './player-figure';

export type LineupAct =
  'cycle' | 'idle' | 'walk' | 'run' | 'air' | 'glide' | 'attack' | 'hurt' | 'dying' | HandAct;

/** Acts with something in hand. */
type HandAct = 'brush' | 'slash' | 'dash' | 'shoot' | 'snipe' | 'launch' | 'charge' | 'cast' | 'field';

interface Hand {
  readonly held: HeldItem;
  readonly kind?: Gesture;
  /** Played back to back (sustained fire) rather than with a pause between. */
  readonly loop?: boolean;
  readonly aim?: boolean;
  readonly paint?: boolean;
  /** Walking while doing it, to see the legs carry on under the arms. */
  readonly walk?: boolean;
}

const HANDS: Readonly<Record<HandAct, Hand>> = {
  brush: { held: 'brush', paint: true },
  slash: { held: 'katana', kind: 'attack' },
  dash: { held: 'katana', kind: 'skill', walk: true },
  shoot: { held: 'rifle', kind: 'attack', loop: true, walk: true },
  snipe: { held: 'sniper', kind: 'attack', aim: true },
  launch: { held: 'launcher', kind: 'attack' },
  charge: { held: 'launcher', kind: 'skill' },
  cast: { held: 'staff', kind: 'attack' },
  field: { held: 'staff', kind: 'skill' },
};
/** In 'attack', the characters in turn. */
const ATTACKS: readonly HandAct[] = ['slash', 'shoot', 'snipe', 'launch', 'cast', 'brush'];

const CYCLE: readonly LineupAct[] = [
  'idle',
  'walk',
  'run',
  'attack',
  'air',
  'glide',
  'hurt',
  'dying',
  'brush',
  'slash',
  'shoot',
  'field',
];
/** Rest between one action and the next, seconds. */
const PAUSE = 0.5;
/** Seconds each act lasts while cycling. */
const ACT_SECONDS = 2.5;
const SPACING = 1.7;
const DISTANCE = 6;
/** Monster kinds standing at the left end of the row; the rest stand at the right end. */
const LEFT = Math.ceil(ENEMIES.length / 2);

interface Slot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  walk: number;
}

export class FigureLineup {
  private readonly group = new THREE.Group();
  private readonly material = makeInkMaterial();
  private readonly cloth = makeInkMaterial({ cloth: true });
  private readonly players = new PlayerFigures(this.group, this.cloth);
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
    const n = CHARACTERS.length + ENEMIES.length;
    this.slots = Array.from({ length: n }, (_, i) => {
      const at = centre.clone().addScaledVector(side, (i - (n - 1) / 2) * SPACING);
      return { x: at.x, z: at.z, yaw: Math.atan2(-(p.x - at.x), -(p.z - at.z)), walk: i };
    });
  }

  private groundAt(x: number, z: number): number {
    return this.ctx.wilderness.townAt(x, z)?.y ?? this.ctx.wilderness.heightAt(x, z);
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
      // which monster kind stands here, or -1 for a player character
      const monster = i < LEFT ? i : i >= LEFT + CHARACTERS.length ? i - CHARACTERS.length : -1;
      const hand =
        monster < 0
          ? act === 'attack'
            ? HANDS[ATTACKS[(i - LEFT) % ATTACKS.length]!]
            : act in HANDS
              ? HANDS[act as HandAct]
              : null
          : null;
      const stride = act === 'walk' || hand?.walk ? 1 : act === 'run' ? 1.7 : 0;
      s.walk += dt * (stride > 1 ? 9 : 6) * Math.min(1, stride);
      const air = act === 'air' || act === 'glide';
      const y =
        this.groundAt(s.x, s.z) +
        (act === 'air' ? Math.sin(phase * Math.PI) * 0.9 : act === 'glide' ? 1.2 : 0);
      const hurt = act === 'hurt' ? Math.max(0, 1 - ((phase * 3) % 1) * 4) : 0;
      const dying = act === 'dying' ? Math.min(1, phase * 1.4) : -1;
      if (monster >= 0) {
        const def = ENEMIES[monster]!;
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
          colors: monster % 2 ? [color('yellow'), color('blue')] : [color('red'), color('yellow')],
        });
      } else {
        this.players.draw(defaultLook(CHARACTERS[i - LEFT]!.key), {
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
          ...(hand ? this.hands(hand, i) : {}),
        });
      }
    });
    this.players.end();
    this.monsters.end();
  }

  /** What a figure holds and does with it, over and over. */
  private hands(hand: Hand, i: number): Partial<PlayerPose> {
    const seconds = hand.kind ? ACTION_SECONDS[hand.held][hand.kind] : 1;
    const k = ((this.t + i * 0.3) % (seconds + (hand.loop ? 0 : PAUSE))) / seconds;
    return {
      held: hand.held,
      action: hand.kind && k < 1 ? { kind: hand.kind, t: k } : null,
      aim: hand.aim || hand.loop ? 1 : 0,
      paint: hand.paint ? 1 : 0,
    };
  }

  dispose(): void {
    this.players.dispose();
    this.monsters.dispose();
    this.group.removeFromParent();
    this.material.dispose();
    this.cloth.dispose();
  }
}

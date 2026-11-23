// The objective line: gathers the facts the rules need a few times a second and keeps the
// current text for the HUD. Lives in shell/ because it only reads the game; the rules
// themselves are in world/objectives.ts.
import { TUNING } from '@/content/tuning';
import { type GameContext, type System, sceneKey } from '@/game/types';
import type { ToolBelt } from '@/systems/tools/tool';
import { CityScene } from '@/systems/city/city-scene';
import type { SceneManager } from '@/systems/scenes/scene-manager';
import { studioOpen } from '@/world/city/features';
import { peacefulVillage } from '@/world/state';
import { bearing, objective, type Point, type Situation } from '@/world/objectives';
import { type Entrance, townDistance } from '@/world/wilderness/generator';
import { lesson } from './hints';

/** How many times each lesson is added to the objective before the player is trusted with it. */
const LESSON_TIMES = 2;

export class ObjectiveSystem implements System {
  readonly id = 'objectives';
  /** The line the HUD shows. */
  text = '';
  /** Seconds of play when the objective itself (not its distance) last changed. */
  changedAt = -Infinity;
  private t = 0;
  private last = '';
  /** The lesson to add to the current objective, decided once when it appears. */
  private teach = '';

  constructor(
    private readonly ctx: GameContext,
    private readonly scenes: SceneManager,
    private readonly belt: ToolBelt,
  ) {}

  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const o = objective(this.situation());
    if (o.text !== this.last) {
      this.last = o.text;
      this.changedAt = this.ctx.state.clock;
      // a lesson counts as shown when its objective appears, so a few showings retire it
      this.teach = o.teach && lesson(`goal:${o.teach.id}`, LESSON_TIMES) ? o.teach.text : '';
    }
    const line = this.teach ? `${o.text}（${this.teach}）` : o.text;
    if (!o.target) {
      this.text = line;
      return;
    }
    const { player } = this.ctx;
    const b = bearing({ x: player.position.x, z: player.position.z }, player.yaw, o.target);
    this.text = b.metres < 6 ? line : `${line}　${b.arrow} ${b.metres} 米`;
  }

  private situation(): Situation {
    const { state, player, wilderness, cities } = this.ctx;
    const p = player.position;
    const near = (points: Point[]): Point | null =>
      points.reduce<Point | null>(
        (best, q) =>
          !best || Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? q : best,
        null,
      );
    const restored = [...state.cities.values()].filter((c) => c.completed).length;
    const drop =
      state.drop && sceneKey(state.drop.scene) === sceneKey(this.scenes.active.ref)
        ? { x: state.drop.x, z: state.drop.z, ink: state.drop.ink }
        : null;
    const base = {
      drop,
      generic: state.inventory.generic,
      ink: state.inventory.ink,
      inkPerGeneric: TUNING.economy.inkPerGeneric,
      visitedCity: state.cities.size > 0,
      restoredCities: restored,
    };
    const scene = this.scenes.active;
    if (scene instanceof CityScene) {
      const l = scene.layout;
      const blocks = scene.blocks();
      const gate = l.gates[0]!;
      const states = scene.states;
      return {
        ...base,
        scene: 'city',
        nextCity: null,
        city: {
          name: l.name,
          completed: scene.completed,
          peaceful: scene.peaceful,
          coloredBlocks: blocks.filter((b) => b === 'colored' || b === 'thriving').length,
          blocks: blocks.length,
          gate: { x: l.ox + (gate.ix + 0.5) * l.cell, z: l.oz + (gate.iz + 0.5) * l.cell },
          studio: near(l.studios.filter((_, i) => studioOpen(l, states, i)).map((s) => s.door)),
          stain: near(l.stains.filter((_, i) => !scene.stains.isCollected(i))),
          guards: scene.monsters.standing(scene.chunkAt(p)),
          nearestGuard: near(scene.monsters.group.living('stronghold').map((v) => ({ x: v.x, z: v.z }))),
          holdsWeapon: this.belt.active?.id === 'weapons',
        },
      };
    }
    const entrances = wilderness
      .entrancesNear(p.x, p.z, 2)
      .filter(
        (e) =>
          !state.cities.get(e.cityId)?.completed && (!base.visitedCity || !peacefulVillage(state, e.cityId)),
      )
      .sort((a, b) => townDistance(a, p.x, p.z) - townDistance(b, p.x, p.z));
    const e = entrances[0];
    // the name and the gate come with the city's layout, worked out in the background; until
    // then, a generic name and the middle of the wall the main gate is in
    const name = e ? (cities.nameOf(e) ?? '一座城') : '';
    return { ...base, scene: 'wild', nextCity: e ? { ...this.mainGate(e), name } : null };
  }

  private mainGate(e: Entrance): { x: number; z: number } {
    const l = this.ctx.cities.byId(e.cityId);
    const g = l?.gates[0];
    if (l && g) return { x: l.ox + (g.ix + 0.5) * l.cell, z: l.oz + (g.iz + 0.5) * l.cell };
    const h = e.size / 2;
    const [dx, dz] = { px: [h, 0], nx: [-h, 0], pz: [0, h], nz: [0, -h] }[e.gate];
    return { x: e.x + dx!, z: e.z + dz! };
  }
}

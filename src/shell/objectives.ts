// The objective line: gathers the facts the rules need a few times a second and keeps the
// current text for the HUD. Lives in shell/ because it only reads the game; the rules
// themselves are in world/objectives.ts.
import { TUNING } from '@/content/tuning';
import type { GameContext, System } from '@/game/types';
import { CityScene } from '@/systems/city/city-scene';
import type { SceneManager } from '@/systems/scenes/scene-manager';
import { studioOpen } from '@/world/city/features';
import { bearing, objective, type Point, type Situation } from '@/world/objectives';

export class ObjectiveSystem implements System {
  readonly id = 'objectives';
  /** The line the HUD shows. */
  text = '';
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly scenes: SceneManager,
  ) {}

  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const o = objective(this.situation());
    if (!o.target) {
      this.text = o.text;
      return;
    }
    const { player } = this.ctx;
    const b = bearing({ x: player.position.x, z: player.position.z }, player.yaw, o.target);
    this.text = b.metres < 6 ? o.text : `${o.text}　${b.arrow} ${b.metres} 米`;
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
    const base = {
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
          coloredBlocks: blocks.filter((b) => b === 'colored' || b === 'thriving').length,
          blocks: blocks.length,
          gate: { x: (gate.ix + 0.5) * l.cell, z: (gate.iz + 0.5) * l.cell },
          studio: near(l.studios.filter((_, i) => studioOpen(l, states, i)).map((s) => s.door)),
          stain: near(l.stains.filter((_, i) => !scene.stains.isCollected(i))),
        },
      };
    }
    const entrances = wilderness
      .entrancesNear(p.x, p.z, 2)
      .filter((e) => !state.cities.get(e.cityId)?.completed)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const e = entrances[0];
    return { ...base, scene: 'wild', nextCity: e ? { x: e.x, z: e.z, name: cities.layout(e).name } : null };
  }
}

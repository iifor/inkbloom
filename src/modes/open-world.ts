// Composition root for the open world. This is the only file that knows every system; to add
// a feature, write a system and add one line in the list below.
import { Input } from '@/engine/input/input';
import { InkRenderer } from '@/engine/render/renderer';
import { EventBus, type GameEvents } from '@/game/events';
import { Loop } from '@/game/loop';
import type { GameContext, System } from '@/game/types';
import { Hud } from '@/shell/hud';
import { ObjectiveSystem } from '@/shell/objectives';
import { CharacterPanel } from '@/shell/character-panel';
import { AudioSystem } from '@/systems/audio/audio-system';
import { EffectsSystem } from '@/systems/effects/effects';
import { CityRegistry } from '@/systems/city/city-registry';
import { ClockSystem } from '@/systems/clock/clock';
import { DebugPanel } from '@/systems/debug/debug-panel';
import { InteractionSystem } from '@/systems/interaction/interaction';
import { PlayerSystem } from '@/systems/player/player';
import { SaveSystem } from '@/systems/save/save-system';
import { SceneManager } from '@/systems/scenes/scene-manager';
import { Brush } from '@/systems/tools/brush';
import { WeaponSlot } from '@/systems/tools/weapons';
import { Marker } from '@/systems/tools/marker';
import { CombatSystem } from '@/systems/combat/combat';
import { InkDropSystem } from '@/systems/combat/ink-drop';
import { ToolBelt } from '@/systems/tools/tool';
import { WildScene } from '@/systems/wilderness/wild-scene';
import { applyPatch } from '@/world/patch';
import { levelOf } from '@/world/progression';
import type { WorldState } from '@/world/state';
import type { WorldStore } from '@/world/store';
import { createWilderness } from '@/world/wilderness/generator';
import { sourceById } from '@/world/wilderness/sources';
import { chunkSaturation, wildMonsterById } from '@/world/wilderness/wild-monsters';
import { ruinById } from '@/world/wilderness/ruins';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface OpenWorld {
  readonly ctx: GameContext;
  readonly scenes: SceneManager;
  readonly belt: ToolBelt;
  readonly save: SaveSystem;
  readonly loop: Loop;
  readonly audio: AudioSystem;
  dispose(): void;
}

export function startOpenWorld(opts: {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  state: WorldState;
  store: WorldStore;
  onError: (e: unknown) => void;
}): OpenWorld {
  const lifetime = new AbortController();
  const ctx = {} as Mutable<GameContext>;
  ctx.state = opts.state;
  ctx.events = new EventBus<GameEvents>();
  ctx.renderer = new InkRenderer(opts.canvas);
  ctx.input = new Input(opts.canvas, lifetime.signal);
  ctx.wilderness = createWilderness(opts.state.seed);
  ctx.cities = new CityRegistry(ctx);
  ctx.apply = (patch) => {
    const levelBefore = levelOf(ctx.state.growth.xp);
    const pointsBefore = ctx.state.growth.points;
    const weaponsBefore = ctx.state.inventory.weapons.length;
    const result = applyPatch(ctx.state, patch, {
      cityOf: (id) => ctx.cities.byId(id) ?? null,
      sourceOf: (id) => sourceById(ctx.wilderness, id),
      ruinOf: (id) => ruinById(ctx.wilderness, id),
      wildMonsterOf: (id) => {
        const m = /^(-?\d+),(-?\d+):/.exec(id);
        if (!m) return null;
        const sat = chunkSaturation(ctx.wilderness, Number(m[1]), Number(m[2]), (c) =>
          ctx.cities.progress(c),
        );
        return wildMonsterById(ctx.wilderness, id, sat);
      },
    });
    if (result.ok) {
      ctx.events.emit('patch:applied', { patch });
      const g = ctx.state.growth;
      const level = levelOf(g.xp);
      if (level > levelBefore) ctx.events.emit('growth:level', { level });
      for (const key of ctx.state.inventory.weapons.slice(weaponsBefore))
        ctx.events.emit('weapon:unlocked', { key });
      if (g.points > pointsBefore)
        ctx.events.emit('growth:points', { gained: g.points - pointsBefore, total: g.points });
    } else ctx.events.emit('patch:rejected', { patch, reason: result.reason });
    return result;
  };

  // the held rifle hangs off the camera, so the camera has to be in the scene graph
  ctx.renderer.scene.add(ctx.renderer.camera);
  const combat = new CombatSystem(ctx);
  ctx.combat = combat;
  const interactions = new InteractionSystem(ctx);
  ctx.interactions = interactions;
  const player = new PlayerSystem(ctx);
  ctx.player = player;
  const scenes = new SceneManager(ctx, new WildScene(ctx));
  ctx.scenes = scenes;
  const belt = new ToolBelt(ctx, [new Brush(ctx), new WeaponSlot(ctx), new Marker(ctx)]);
  const inkDrop = new InkDropSystem(ctx);
  const save = new SaveSystem(ctx, opts.store);
  const clock = new ClockSystem(ctx);
  const objectives = new ObjectiveSystem(ctx, scenes, belt);
  const panel = new CharacterPanel(ctx, opts.hudRoot.parentElement ?? opts.hudRoot);
  const audio = new AudioSystem(ctx);
  const effects = new EffectsSystem(ctx);
  const hud = new Hud(ctx, opts.hudRoot, belt, scenes, objectives);
  const debug = new DebugPanel(ctx, opts.hudRoot.parentElement ?? opts.hudRoot);

  // Order matters: movement, then the scene streams around the new position, then
  // interaction/tools read the settled camera, then HUD and save observe the result.
  const systems: System[] = [
    clock,
    player,
    combat,
    scenes,
    interactions,
    panel,
    belt,
    inkDrop,
    objectives,
    hud,
    audio,
    effects,
    save,
    debug,
  ];

  scenes.restore(opts.state.player);

  const resize = (): void => ctx.renderer.resize();
  window.addEventListener('resize', resize, { signal: lifetime.signal });

  const loop = new Loop(
    systems,
    () => ctx.input.update(),
    () => {
      ctx.renderer.render();
    },
    opts.onError,
  );
  loop.start();

  return {
    ctx,
    scenes,
    belt,
    save,
    loop,
    audio,
    dispose() {
      loop.stop();
      void save.flush();
      lifetime.abort();
      for (const s of [...systems].reverse()) s.dispose?.();
      ctx.events.clear();
      ctx.renderer.dispose();
    },
  };
}

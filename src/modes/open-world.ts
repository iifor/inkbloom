// Composition root for the open world. This is the only file that knows every system; to add
// a feature, write a system and add one line in the list below.
import { Input } from '@/engine/input/input';
import { InkRenderer } from '@/engine/render/renderer';
import { EventBus, type GameEvents } from '@/game/events';
import { Loop } from '@/game/loop';
import type { GameContext, System } from '@/game/types';
import { Hud } from '@/shell/hud';
import { CityRegistry } from '@/systems/city/city-registry';
import { ClockSystem } from '@/systems/clock/clock';
import { DebugPanel } from '@/systems/debug/debug-panel';
import { InteractionSystem } from '@/systems/interaction/interaction';
import { PlayerSystem } from '@/systems/player/player';
import { SaveSystem } from '@/systems/save/save-system';
import { SceneManager } from '@/systems/scenes/scene-manager';
import { Brush } from '@/systems/tools/brush';
import { ToolBelt } from '@/systems/tools/tool';
import { WildScene } from '@/systems/wilderness/wild-scene';
import { applyPatch } from '@/world/patch';
import type { WorldState } from '@/world/state';
import type { WorldStore } from '@/world/store';
import { createWilderness } from '@/world/wilderness/generator';
import { sourceById } from '@/world/wilderness/sources';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface OpenWorld {
  readonly ctx: GameContext;
  readonly scenes: SceneManager;
  readonly belt: ToolBelt;
  readonly save: SaveSystem;
  readonly loop: Loop;
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
    const result = applyPatch(ctx.state, patch, {
      cityOf: (id) => ctx.cities.byId(id) ?? null,
      sourceOf: (id) => sourceById(ctx.wilderness, id),
    });
    if (result.ok) ctx.events.emit('patch:applied', { patch });
    else ctx.events.emit('patch:rejected', { patch, reason: result.reason });
    return result;
  };

  const interactions = new InteractionSystem(ctx);
  ctx.interactions = interactions;
  const player = new PlayerSystem(ctx);
  ctx.player = player;
  const scenes = new SceneManager(ctx, new WildScene(ctx));
  ctx.scenes = scenes;
  const belt = new ToolBelt(ctx, [new Brush(ctx)]);
  const save = new SaveSystem(ctx, opts.store);
  const clock = new ClockSystem(ctx);
  const hud = new Hud(ctx, opts.hudRoot, belt, scenes);
  const debug = new DebugPanel(ctx, opts.hudRoot.parentElement ?? opts.hudRoot);

  // Order matters: movement, then the scene streams around the new position, then
  // interaction/tools read the settled camera, then HUD and save observe the result.
  const systems: System[] = [clock, player, scenes, interactions, belt, hud, save, debug];

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

// Composition root for the open world. This is the only file that knows every system; to add
// a feature, write a system and add one line in the list below.
import { Input } from '@/engine/input/input';
import { InkRenderer } from '@/engine/render/renderer';
import { warmShaders } from '@/engine/render/warm-up';
import { EventBus, type GameEvents } from '@/game/events';
import { Loop } from '@/game/loop';
import type { GameContext, System } from '@/game/types';
import { Hud } from '@/shell/hud';
import { ObjectiveSystem } from '@/shell/objectives';
import { CharacterPanel } from '@/shell/character-panel';
import { AtmosphereSystem } from '@/systems/atmosphere/atmosphere';
import { AudioSystem } from '@/systems/audio/audio-system';
import { EffectsSystem } from '@/systems/effects/effects';
import { CombatOverlay } from '@/shell/combat-overlay';
import { PlaytestSystem } from '@/systems/playtest/playtest-system';
import { CityRegistry } from '@/systems/city/city-registry';
import { CityScene } from '@/systems/city/city-scene';
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
import type { Connection } from '@/systems/net/connection';
import { ArenaSystem } from '@/systems/arena/arena-system';
import { ArenaHud } from '@/shell/arena-hud';
import { NetSystem } from '@/systems/net/net-system';
import { RemotePlayers } from '@/systems/net/remote-players';
import { type Fix, applyFix } from '@/world/net/fix';
import { worldPatchContext } from '@/world/net/patch-context';
import { standInSlice, withSlice } from '@/world/net/slices';
import { type Patch, applyPatch } from '@/world/patch';
import { levelOf } from '@/world/progression';
import type { WorldState } from '@/world/state';
import type { KeyValue, WorldStore } from '@/world/store';
import { createWilderness } from '@/world/wilderness/generator';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface OpenWorld {
  readonly ctx: GameContext;
  readonly scenes: SceneManager;
  readonly belt: ToolBelt;
  readonly save: SaveSystem;
  readonly loop: Loop;
  readonly audio: AudioSystem;
  readonly playtest: PlaytestSystem;
  /** The server world this client is in; null when playing alone. */
  readonly net: NetSystem | null;
  /** The arena of that server world; null when playing alone. */
  readonly arena: ArenaSystem | null;
  dispose(): void;
}

export function startOpenWorld(opts: {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  state: WorldState;
  store: WorldStore;
  /** Where the playtest log is kept; null keeps it in memory only. */
  kv?: KeyValue | null;
  /** Joined to a world server (multiplayer); absent when playing alone. */
  net?: Connection;
  onError: (e: unknown) => void;
}): OpenWorld {
  const lifetime = new AbortController();
  const ctx = {} as Mutable<GameContext>;
  ctx.state = opts.state;
  ctx.events = new EventBus<GameEvents>();
  ctx.renderer = new InkRenderer(opts.canvas);
  ctx.input = new Input(opts.canvas, lifetime.signal);
  ctx.wilderness = createWilderness(opts.state.seed);
  const cities = new CityRegistry(ctx);
  ctx.cities = cities;
  // a town nobody here has walked to yet still has a layout: work it out when a patch needs it
  const patchContext = worldPatchContext(
    ctx.wilderness,
    (id) => {
      const known = ctx.cities.byId(id);
      if (known) return known;
      const e = ctx.cities.entranceOf(id);
      return e ? ctx.cities.layout(e) : null;
    },
    (id) => ctx.cities.progress(id),
  );
  ctx.apply = (patch) => {
    const levelBefore = levelOf(ctx.state.growth.xp);
    const pointsBefore = ctx.state.growth.points;
    const weaponsBefore = ctx.state.inventory.weapons.length;
    const result = applyPatch(ctx.state, patch, patchContext);
    if (result.ok) {
      // in a server world the server judges it too, and tells the others
      ctx.net?.sendPatch(patch);
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
  const wild = new WildScene(ctx);
  const scenes = new SceneManager(
    ctx,
    wild,
    (entrance, layout, physics) => new CityScene(ctx, entrance, layout, physics),
  );
  ctx.scenes = scenes;
  const weapons = new WeaponSlot(ctx);
  const belt = new ToolBelt(ctx, [new Brush(ctx), weapons, new Marker(ctx)]);
  const inkDrop = new InkDropSystem(ctx);
  const save = new SaveSystem(ctx, opts.store);
  const clock = new ClockSystem(ctx);
  const objectives = new ObjectiveSystem(ctx, scenes, belt);
  const panel = new CharacterPanel(ctx, opts.hudRoot.parentElement ?? opts.hudRoot);
  const audio = new AudioSystem(ctx);
  const effects = new EffectsSystem(ctx);
  const atmosphere = new AtmosphereSystem(ctx);
  const hud = new Hud(ctx, opts.hudRoot, belt, scenes, objectives);
  // after the HUD, which rewrites its root when built
  const overlay = new CombatOverlay(ctx, opts.hudRoot);
  const playtest = new PlaytestSystem(ctx, opts.kv ?? null);
  const debug = new DebugPanel(ctx, opts.hudRoot.parentElement ?? opts.hudRoot);
  // a server world: other players, and the line to the server
  let net: NetSystem | null = null;
  let remote: RemotePlayers | null = null;
  let arena: ArenaSystem | null = null;
  let arenaHud: ArenaHud | null = null;
  if (opts.net) {
    remote = new RemotePlayers(ctx, opts.hudRoot);
    // another player's patch, already judged by the server: only its effect on the shared world
    // lands here; what it pays goes to a stand-in and is thrown away
    const standIn = standInSlice();
    // set the server's values, and tell the town on screen what that changed (as others' doing:
    // it updates what is shown, with none of this player's own sounds or rewards)
    const correct = (fix: Fix | null): void => {
      const c = applyFix(ctx.state, fix);
      if (!c.city) return;
      const city = c.city;
      const states = ctx.state.cities.get(city)!.states;
      const tell = (patch: Patch): void => ctx.events.emit('patch:applied', { patch, remote: true });
      for (const surface of c.surfaces)
        tell({ kind: states[surface] === 0 ? 'drain' : 'restore', city, surface });
      for (const stain of c.stains) tell({ kind: 'collect', city, stain });
      for (const monster of c.defeated) tell({ kind: 'defeat', city, monster });
    };
    const run = (patch: Patch, fix: Fix | null): void => {
      // the patch creates the town's save if this client has none yet; the fix then sets its values
      const r = withSlice(ctx.state, standIn, () => applyPatch(ctx.state, patch, patchContext));
      if (r.ok) ctx.events.emit('patch:applied', { patch, remote: true });
      correct(fix);
    };
    // a patch in a town this client has not worked out yet waits while the worker lays it out,
    // rather than stalling the frame (in order; after a few seconds it is worked out here)
    const waiting: { patch: Patch; fix: Fix | null; since: number }[] = [];
    const remotePatches = {
      apply(patch: Patch, fix: Fix | null): void {
        if ('city' in patch && !ctx.cities.byId(patch.city)) {
          const e = ctx.cities.entranceOf(patch.city);
          if (!e) return;
          ctx.cities.prefetch(e);
          waiting.push({ patch, fix, since: performance.now() });
        } else if (waiting.length) waiting.push({ patch, fix, since: performance.now() });
        else run(patch, fix);
      },
      flush(): void {
        while (waiting.length) {
          const w = waiting[0]!;
          const ready = !('city' in w.patch) || ctx.cities.byId(w.patch.city);
          if (!ready && performance.now() - w.since < 3000) break;
          waiting.shift();
          run(w.patch, w.fix);
        }
      },
      correct,
    };
    net = new NetSystem(ctx, opts.net, remote, remotePatches);
    ctx.net = net;
    arena = new ArenaSystem(ctx, net, remote, wild, weapons);
    ctx.arena = arena;
    arenaHud = new ArenaHud(ctx, arena, opts.hudRoot);
  }

  // Order matters: movement, then the scene streams around the new position, then
  // interaction/tools read the settled camera, then HUD and save observe the result.
  const systems: System[] = [
    clock,
    ...(net ? [net] : []),
    player,
    combat,
    scenes,
    ...(remote ? [remote] : []),
    ...(arena ? [arena] : []),
    interactions,
    panel,
    belt,
    inkDrop,
    objectives,
    hud,
    audio,
    effects,
    atmosphere,
    overlay,
    ...(arenaHud ? [arenaHud] : []),
    playtest,
    save,
    debug,
  ];

  scenes.restore(opts.state.player);
  // compile the shader variants a city or an effect will need now, not on first use
  warmShaders(ctx.renderer);

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
    playtest,
    loop,
    audio,
    net,
    arena,
    dispose() {
      net?.leave();
      loop.stop();
      void save.flush();
      lifetime.abort();
      for (const s of [...systems].reverse()) s.dispose?.();
      ctx.events.clear();
      cities.dispose();
      ctx.renderer.dispose();
    },
  };
}

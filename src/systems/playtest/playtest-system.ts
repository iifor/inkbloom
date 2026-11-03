// Records a playtest log (world/playtest.ts) while the game runs: where pigment came from and
// went, how long each block took, fights, deaths, tides and refusals. Listens to events and
// samples the save; changes nothing. Kept in local storage per world and exported as a
// Markdown report from the pause menu.
import type { GameContext, System } from '@/game/types';
import { blockStates, type BlockState } from '@/world/city/blocks';
import { openRequests } from '@/world/city/features';
import {
  type CityLog,
  addEvent,
  addFlow,
  addSample,
  noteBlock,
  noteEntered,
  parseLog,
  report,
  type PlaytestLog,
} from '@/world/playtest';
import { levelOf } from '@/world/progression';
import type { KeyValue } from '@/world/store';
import { WEAPONS } from '@/content/weapons';

const BLOCK_EVERY = 2;
const SAMPLE_EVERY = 60;
const PERSIST_EVERY_MS = 30_000;

interface Purse {
  generic: number;
  ink: number;
  colored: number;
}

export class PlaytestSystem implements System {
  readonly id = 'playtest';
  readonly log: PlaytestLog;
  private readonly key: string;
  private readonly release: (() => void)[] = [];
  private purse: Purse;
  private lastClock: number;
  private blockT = 0;
  private sampleT = 0;
  private persistedAt = performance.now();
  /** Last block states seen per city. */
  private readonly seen = new Map<string, BlockState[]>();
  private readonly onHide = (): void => this.persist();

  constructor(
    private readonly ctx: GameContext,
    private readonly kv: KeyValue | null,
  ) {
    const state = ctx.state;
    this.key = `inkbloom:playtest:${state.id}`;
    let stored: string | null = null;
    try {
      stored = kv?.getItem(this.key) ?? null;
    } catch {
      stored = null;
    }
    this.log = parseLog(stored, state.id, new Date());
    this.log.sessions++;
    this.lastClock = state.clock;
    this.purse = this.read();
    addEvent(this.log, { t: state.clock, kind: 'session', text: `第 ${this.log.sessions} 次打开` });

    const on = ctx.events.on.bind(ctx.events);
    const c = this.log.combat;
    this.release.push(
      on('patch:applied', ({ patch }) => {
        const now = this.read();
        addFlow(this.log, patch.kind, {
          generic: now.generic - this.purse.generic,
          ink: now.ink - this.purse.ink,
          colored: now.colored - this.purse.colored,
        });
        this.purse = now;
        if (patch.kind === 'upgrade')
          addEvent(this.log, { t: state.clock, kind: 'upgrade', text: '升级了笔刷' });
      }),
      on('patch:rejected', ({ reason }) => {
        // numbers vary ("需要 3，剩 1"); the reason is the same wall
        const r = reason.replace(/\d+/g, 'N');
        this.log.rejections[r] = (this.log.rejections[r] ?? 0) + 1;
      }),
      on('weapon:fired', () => c.shots++),
      on('shot:hit', () => c.hits++),
      on('monster:hit', ({ amount }) => (c.dealt += amount)),
      on('monster:died', ({ amount }) => {
        c.dealt += amount;
        c.kills++;
      }),
      on('player:hurt', ({ amount, absorbed }) => {
        c.taken += amount;
        c.absorbed += absorbed;
      }),
      on('player:died', ({ lostInk }) => {
        c.deaths++;
        addEvent(this.log, {
          t: state.clock,
          kind: 'death',
          text: `${this.where()}：倒下，掉了 ${lostInk} 墨`,
        });
      }),
      on('tide:warning', () => this.log.tides.warned++),
      on('tide:end', ({ held }) => {
        if (held) this.log.tides.held++;
        else this.log.tides.lost++;
        addEvent(this.log, {
          t: state.clock,
          kind: 'tide',
          text: `${this.where()}：${held ? '守住' : '失守'}墨潮`,
        });
      }),
      on('growth:level', ({ level }) =>
        addEvent(this.log, { t: state.clock, kind: 'level', text: `升到 ${level} 级` }),
      ),
      on('weapon:unlocked', ({ key }) =>
        addEvent(this.log, {
          t: state.clock,
          kind: 'unlock',
          text: `解锁武器 ${WEAPONS.find((w) => w.key === key)?.name ?? key}`,
        }),
      ),
      on('scene:entered', ({ ref, name }) => {
        if (ref.kind !== 'city') return;
        this.city(ref.id, name);
        addEvent(this.log, { t: state.clock, kind: 'city', text: `进入${name}` });
      }),
      on('city:completed', ({ city, name }) => {
        const log = this.city(city, name);
        log.completed ??= Math.round(state.clock - log.firstEntered);
        addEvent(this.log, { t: state.clock, kind: 'city', text: `${name}全城恢复` });
      }),
    );
    window.addEventListener('pagehide', this.onHide);
  }

  private read(): Purse {
    const inv = this.ctx.state.inventory;
    return { generic: inv.generic, ink: inv.ink, colored: inv.colored.reduce((a, x) => a + x, 0) };
  }

  private city(id: string, name: string): CityLog {
    return (this.log.cities[id] ??= { name, firstEntered: this.ctx.state.clock, seconds: 0, blocks: {} });
  }

  /** "城名 街区 N" or "野外". */
  private where(): string {
    const ref = this.ctx.scenes.active.ref;
    if (ref.kind !== 'city') return '野外';
    const chunk = this.chunkHere(ref.id);
    return `${this.ctx.scenes.active.name}${chunk === null ? '' : ` 街区 ${chunk}`}`;
  }

  private chunkHere(cityId: string): number | null {
    const l = this.ctx.cities.byId(cityId);
    if (!l) return null;
    const p = this.ctx.player.position;
    const per = l.size / l.chunks;
    const cx = Math.min(l.chunks - 1, Math.max(0, Math.floor(p.x / per)));
    const cz = Math.min(l.chunks - 1, Math.max(0, Math.floor(p.z / per)));
    return cz * l.chunks + cx;
  }

  update(): void {
    const { state, scenes } = this.ctx;
    const d = state.clock - this.lastClock;
    this.lastClock = state.clock;
    // a paused or reloaded clock does not count as play
    if (d <= 0 || d > 5) return;
    const ref = scenes.active.ref;
    if (ref.kind === 'city') this.city(ref.id, scenes.active.name).seconds += d;
    else this.log.wildSeconds += d;

    this.blockT -= d;
    if (this.blockT <= 0 && ref.kind === 'city') {
      this.blockT = BLOCK_EVERY;
      this.blocks(ref.id);
    }
    this.sampleT -= d;
    if (this.sampleT <= 0) {
      this.sampleT = SAMPLE_EVERY;
      const p = this.read();
      addSample(this.log, {
        t: Math.round(state.clock),
        level: levelOf(state.growth.xp),
        ...p,
        scene: ref.kind === 'city' ? scenes.active.name : '野外',
      });
    }
    if (performance.now() - this.persistedAt > PERSIST_EVERY_MS) this.persist();
  }

  private blocks(cityId: string): void {
    const layout = this.ctx.cities.byId(cityId);
    const saved = this.ctx.state.cities.get(cityId);
    if (!layout || !saved) return;
    const city = this.city(cityId, this.ctx.scenes.active.name);
    const now = this.ctx.state.clock;
    const states = blockStates(
      saved.states,
      layout.surfaces,
      layout.chunks,
      (c) => openRequests(layout, saved.requestsDone, c).length === 0,
    );
    const prev = this.seen.get(cityId);
    states.forEach((s, i) => noteBlock(city, i, s, prev?.[i] ?? null, now));
    this.seen.set(cityId, states);
    const here = this.chunkHere(cityId);
    if (here !== null) noteEntered(city, here, now);
  }

  /** The report as Markdown. */
  report(): string {
    return report(this.log, this.ctx.state.clock);
  }

  persist(): void {
    this.persistedAt = performance.now();
    try {
      this.kv?.setItem(this.key, JSON.stringify(this.log));
    } catch {
      // storage full or blocked: the log lives on in memory and can still be exported
    }
  }

  dispose(): void {
    this.persist();
    window.removeEventListener('pagehide', this.onHide);
    for (const r of this.release) r();
  }
}

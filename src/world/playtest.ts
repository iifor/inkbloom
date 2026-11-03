// The playtest log: what happened while someone played, kept in the browser so the numbers in
// content/tuning.ts can be tuned from real play instead of guesses. Nothing leaves the browser
// unless the player exports the report from the pause menu. Pure data and formatting; the
// recording system is systems/playtest/playtest-system.ts.
import { BLOCK_NAMES, type BlockState } from './city/blocks';

export const PLAYTEST_VERSION = 1;
/** Oldest entries are dropped beyond these, so the log stays a few hundred KB at most. */
export const MAX_EVENTS = 1500;
export const MAX_SAMPLES = 720;

/** Pigment and ink moved by one kind of change. */
export interface Flow {
  generic: number;
  ink: number;
  /** All coloured pigments together. */
  colored: number;
  count: number;
}

/** Play-clock seconds (since the city was first entered) at which a block first got somewhere. */
export interface BlockLog {
  entered?: number;
  cleared?: number;
  colored?: number;
  thriving?: number;
  /** Times it fell from 有色 or better back below it. */
  lost: number;
}

export interface CityLog {
  name: string;
  /** Play clock when first entered. */
  firstEntered: number;
  /** Play seconds spent inside. */
  seconds: number;
  /** Seconds after first entry that it was fully restored. */
  completed?: number;
  blocks: Record<string, BlockLog>;
}

export interface Sample {
  /** Play clock. */
  t: number;
  level: number;
  generic: number;
  ink: number;
  colored: number;
  scene: string;
}

export type EventKind = 'session' | 'death' | 'level' | 'tide' | 'city' | 'unlock' | 'upgrade';

export interface LogEvent {
  t: number;
  kind: EventKind;
  text: string;
}

export interface PlaytestLog {
  version: typeof PLAYTEST_VERSION;
  world: string;
  /** Real date the log was started (ISO). */
  created: string;
  sessions: number;
  wildSeconds: number;
  cities: Record<string, CityLog>;
  gain: Record<string, Flow>;
  spend: Record<string, Flow>;
  /** Refused changes by reason ("颜料不足" and friends): where players hit a wall. */
  rejections: Record<string, number>;
  combat: {
    shots: number;
    hits: number;
    kills: number;
    dealt: number;
    taken: number;
    absorbed: number;
    deaths: number;
  };
  tides: { warned: number; held: number; lost: number };
  samples: Sample[];
  events: LogEvent[];
}

export function newLog(world: string, now: Date): PlaytestLog {
  return {
    version: PLAYTEST_VERSION,
    world,
    created: now.toISOString(),
    sessions: 0,
    wildSeconds: 0,
    cities: {},
    gain: {},
    spend: {},
    rejections: {},
    combat: { shots: 0, hits: 0, kills: 0, dealt: 0, taken: 0, absorbed: 0, deaths: 0 },
    tides: { warned: 0, held: 0, lost: 0 },
    samples: [],
    events: [],
  };
}

/** Read a stored log; anything unreadable, older or for another world starts a fresh one. */
export function parseLog(text: string | null, world: string, now: Date): PlaytestLog {
  if (!text) return newLog(world, now);
  try {
    const j = JSON.parse(text) as Partial<PlaytestLog>;
    if (j.version !== PLAYTEST_VERSION || j.world !== world) return newLog(world, now);
    // fill anything a hand-edited or truncated log lost
    return { ...newLog(world, now), ...j } as PlaytestLog;
  } catch {
    return newLog(world, now);
  }
}

const emptyFlow = (): Flow => ({ generic: 0, ink: 0, colored: 0, count: 0 });

/** Book a change of inventory under the patch kind that caused it. */
export function addFlow(
  log: PlaytestLog,
  kind: string,
  d: { generic: number; ink: number; colored: number },
): void {
  const up = { generic: Math.max(0, d.generic), ink: Math.max(0, d.ink), colored: Math.max(0, d.colored) };
  const down = {
    generic: Math.max(0, -d.generic),
    ink: Math.max(0, -d.ink),
    colored: Math.max(0, -d.colored),
  };
  for (const [book, part] of [
    [log.gain, up],
    [log.spend, down],
  ] as const) {
    if (!part.generic && !part.ink && !part.colored) continue;
    const f = (book[kind] ??= emptyFlow());
    f.generic += part.generic;
    f.ink += part.ink;
    f.colored += part.colored;
    f.count++;
  }
}

export function addEvent(log: PlaytestLog, e: LogEvent): void {
  log.events.push(e);
  if (log.events.length > MAX_EVENTS) log.events.splice(0, log.events.length - MAX_EVENTS);
}

export function addSample(log: PlaytestLog, s: Sample): void {
  log.samples.push(s);
  // keep the whole history at half the resolution rather than losing the start
  if (log.samples.length > MAX_SAMPLES) log.samples = log.samples.filter((_, i) => i % 2 === 0);
}

const RANK: Record<BlockState, number> = { drained: 0, cleared: 1, colored: 2, thriving: 3 };

/**
 * Note a block's state at play clock `t`. Records the first time each state is reached and
 * counts falls from 有色 or better. `prev` is the state seen last time (null on first look).
 */
export function noteBlock(
  city: CityLog,
  chunk: number,
  state: BlockState,
  prev: BlockState | null,
  t: number,
): void {
  const b = (city.blocks[chunk] ??= { lost: 0 });
  const at = Math.round(t - city.firstEntered);
  if (RANK[state] >= RANK.cleared) b.cleared ??= at;
  if (RANK[state] >= RANK.colored) b.colored ??= at;
  if (state === 'thriving') b.thriving ??= at;
  if (prev && RANK[prev] >= RANK.colored && RANK[state] < RANK.colored) b.lost++;
}

export function noteEntered(city: CityLog, chunk: number, t: number): void {
  const b = (city.blocks[chunk] ??= { lost: 0 });
  b.entered ??= Math.round(t - city.firstEntered);
}

const KIND_NAMES: Record<string, string> = {
  restore: '修复上色',
  paint: '涂鸦',
  collect: '吸墨渍',
  refine: '画室炼颜料',
  collectStock: '领画室存货',
  harvest: '野外采颜料',
  defeat: '打败据点墨怪',
  hunt: '打败野外墨怪',
  death: '倒下掉墨',
  recover: '捡回掉落',
  discover: '发现遗迹',
  request: '完成心愿',
  mark: '放墨迹标记',
  unmark: '收回标记',
  tideHeld: '守住墨潮',
  upgrade: '升级笔刷',
  complete: '恢复整座城',
  spend: '推墨潮等花费',
  grant: '奖励',
};

/** Minutes:seconds. */
export function clock(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

const flowText = (f: Flow): string =>
  [f.generic && `通用 ${f.generic}`, f.ink && `墨 ${f.ink}`, f.colored && `彩色 ${f.colored}`]
    .filter(Boolean)
    .join('，');

/** The report as Markdown, for the player to send back. The raw log goes in a JSON block. */
export function report(log: PlaytestLog, playClock: number): string {
  const L: string[] = [];
  const c = log.combat;
  const citySeconds = Object.values(log.cities).reduce((a, x) => a + x.seconds, 0);
  L.push(`# 试玩报告：${log.world}`, '');
  L.push(
    `开始于 ${log.created.slice(0, 16).replace('T', ' ')}，共 ${log.sessions} 次打开。这个世界的游戏时间 ${clock(playClock)}，其中有记录的 ${clock(citySeconds + log.wildSeconds)}。`,
    '',
  );
  L.push('## 概要', '');
  L.push('| 项目 | 数值 |', '|---|---|');
  L.push(`| 城里 / 野外 | ${clock(citySeconds)} / ${clock(log.wildSeconds)} |`);
  L.push(`| 开枪 / 命中 / 击杀 | ${c.shots} / ${c.hits} / ${c.kills} |`);
  L.push(
    `| 造成伤害 / 受到伤害 / 护盾吸收 | ${Math.round(c.dealt)} / ${Math.round(c.taken)} / ${Math.round(c.absorbed)} |`,
  );
  L.push(`| 倒下 | ${c.deaths} |`);
  L.push(`| 墨潮 预警 / 守住 / 失守 | ${log.tides.warned} / ${log.tides.held} / ${log.tides.lost} |`);
  L.push('');

  for (const [id, city] of Object.entries(log.cities)) {
    L.push(`## ${city.name}（${id}）`, '');
    L.push(
      `待了 ${clock(city.seconds)}${city.completed !== undefined ? `，进城后 ${clock(city.completed)} 全城恢复` : '，还没恢复'}。时间从第一次进城算起。`,
      '',
    );
    L.push(
      `| 街区 | 第一次进入 | ${BLOCK_NAMES.cleared} | ${BLOCK_NAMES.colored} | ${BLOCK_NAMES.thriving} | 失守次数 |`,
    );
    L.push('|---|---|---|---|---|---|');
    const t = (s: number | undefined): string => (s === undefined ? '—' : clock(s));
    for (const [chunk, b] of Object.entries(city.blocks).sort((a, b) => Number(a[0]) - Number(b[0])))
      L.push(
        `| ${chunk} | ${t(b.entered)} | ${t(b.cleared)} | ${t(b.colored)} | ${t(b.thriving)} | ${b.lost} |`,
      );
    L.push('');
  }

  L.push('## 颜料收支', '');
  L.push('| 来源 | 得到 | 次数 |', '|---|---|---|');
  for (const [k, f] of Object.entries(log.gain).sort((a, b) => b[1].generic - a[1].generic))
    L.push(`| ${KIND_NAMES[k] ?? k} | ${flowText(f)} | ${f.count} |`);
  L.push('', '| 去处 | 花掉 | 次数 |', '|---|---|---|');
  for (const [k, f] of Object.entries(log.spend).sort((a, b) => b[1].generic - a[1].generic))
    L.push(`| ${KIND_NAMES[k] ?? k} | ${flowText(f)} | ${f.count} |`);
  L.push('');

  const rej = Object.entries(log.rejections).sort((a, b) => b[1] - a[1]);
  if (rej.length) {
    L.push('## 被拒绝的操作（卡住的地方）', '', '| 原因 | 次数 |', '|---|---|');
    for (const [r, n] of rej) L.push(`| ${r} | ${n} |`);
    L.push('');
  }

  if (log.samples.length) {
    L.push(
      '## 资源曲线（每 5 分钟）',
      '',
      '| 时间 | 等级 | 通用颜料 | 墨 | 彩色颜料 | 在哪 |',
      '|---|---|---|---|---|---|',
    );
    let next = 0;
    for (const s of log.samples) {
      if (s.t < next) continue;
      next = s.t + 300;
      L.push(`| ${clock(s.t)} | ${s.level} | ${s.generic} | ${s.ink} | ${s.colored} | ${s.scene} |`);
    }
    L.push('');
  }

  if (log.events.length) {
    L.push('## 经过', '');
    for (const e of log.events) L.push(`- ${clock(e.t)} ${e.text}`);
    L.push('');
  }

  L.push('## 原始数据', '', '```json', JSON.stringify(log), '```', '');
  return L.join('\n');
}

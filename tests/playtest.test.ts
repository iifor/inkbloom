import { describe, expect, it } from 'vitest';
import {
  MAX_EVENTS,
  MAX_SAMPLES,
  addEvent,
  addFlow,
  addSample,
  clock,
  newLog,
  noteBlock,
  noteEntered,
  parseLog,
  report,
  type CityLog,
} from '@/world/playtest';

const NOW = new Date('2026-11-02T10:00:00Z');
const city = (): CityLog => ({ name: '橘石城', firstEntered: 100, seconds: 0, blocks: {} });

describe('playtest log', () => {
  it('books gains and spending separately under the change that caused them', () => {
    const log = newLog('w', NOW);
    addFlow(log, 'collect', { generic: 0, ink: 10, colored: 0 });
    addFlow(log, 'collect', { generic: 0, ink: 10, colored: 0 });
    addFlow(log, 'refine', { generic: 5, ink: -10, colored: 0 });
    addFlow(log, 'restore', { generic: -1, ink: 0, colored: 0 });
    expect(log.gain.collect).toEqual({ generic: 0, ink: 20, colored: 0, count: 2 });
    expect(log.gain.refine).toEqual({ generic: 5, ink: 0, colored: 0, count: 1 });
    expect(log.spend.refine).toEqual({ generic: 0, ink: 10, colored: 0, count: 1 });
    expect(log.spend.restore!.generic).toBe(1);
    // a change that moved nothing books nothing
    addFlow(log, 'drain', { generic: 0, ink: 0, colored: 0 });
    expect(log.gain.drain).toBeUndefined();
    expect(log.spend.drain).toBeUndefined();
  });

  it('times blocks from the first visit to the city and counts falls from colour', () => {
    const c = city();
    noteEntered(c, 2, 130);
    noteEntered(c, 2, 400);
    noteBlock(c, 2, 'drained', null, 130);
    noteBlock(c, 2, 'cleared', 'drained', 220);
    noteBlock(c, 2, 'colored', 'cleared', 460);
    noteBlock(c, 2, 'cleared', 'colored', 600);
    noteBlock(c, 2, 'colored', 'cleared', 700);
    expect(c.blocks[2]).toEqual({ entered: 30, cleared: 120, colored: 360, lost: 1 });
  });

  it('keeps the newest events and the whole sample history at lower resolution', () => {
    const log = newLog('w', NOW);
    for (let i = 0; i < MAX_EVENTS + 10; i++) addEvent(log, { t: i, kind: 'level', text: String(i) });
    expect(log.events).toHaveLength(MAX_EVENTS);
    expect(log.events[0]!.t).toBe(10);
    for (let i = 0; i <= MAX_SAMPLES; i++)
      addSample(log, { t: i * 60, level: 1, generic: 0, ink: 0, colored: 0, scene: '野外' });
    expect(log.samples.length).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(log.samples[0]!.t).toBe(0);
  });

  it('starts fresh for another world, another version or a broken file', () => {
    const log = newLog('w', NOW);
    log.sessions = 3;
    const text = JSON.stringify(log);
    expect(parseLog(text, 'w', NOW).sessions).toBe(3);
    expect(parseLog(text, 'other', NOW).sessions).toBe(0);
    expect(parseLog('{"version":0,"world":"w"}', 'w', NOW).sessions).toBe(0);
    expect(parseLog('{not json', 'w', NOW).sessions).toBe(0);
    expect(parseLog(null, 'w', NOW).world).toBe('w');
  });

  it('writes a readable report with the raw log attached', () => {
    const log = newLog('w', NOW);
    log.sessions = 1;
    log.cities.c1 = city();
    noteBlock(log.cities.c1, 0, 'colored', null, 400);
    addFlow(log, 'collect', { generic: 0, ink: 30, colored: 0 });
    log.rejections['颜料不足（需要 N，剩 N）'] = 4;
    addEvent(log, { t: 90, kind: 'death', text: '在野外倒下，掉了 12 墨' });
    const md = report(log, 3725);
    expect(md).toContain('# 试玩报告：w');
    expect(md).toContain('游戏时间 62:05，其中有记录的 0:00');
    expect(md).toContain('| 0 | — | 5:00 | 5:00 | — | 0 |');
    expect(md).toContain('| 吸墨渍 | 墨 30 | 1 |');
    expect(md).toContain('颜料不足（需要 N，剩 N） | 4');
    expect(md).toContain('- 1:30 在野外倒下，掉了 12 墨');
    const raw = md.slice(md.indexOf('```json') + 7, md.lastIndexOf('```'));
    expect(JSON.parse(raw).world).toBe('w');
  });

  it('formats play time as minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(61.9)).toBe('1:01');
    expect(clock(3600)).toBe('60:00');
  });
});

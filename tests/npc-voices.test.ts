import { existsSync } from 'node:fs';
import catalogue from '@/content/npc-voices.json';
import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { headless } from './support/headless';
import { NpcFighter, npcBattles } from '@/systems/combat/npc-combat';
import { NpcVoices } from '@/systems/audio/npc-voices';
import type { Synth } from '@/engine/audio/synth';
afterEach(() => vi.unstubAllGlobals());
it('greets once per visit, respects cooldown, combat and mute', () => {
  const speak = vi.fn(),
    cancel = vi.fn();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    speechSynthesis: { speak, cancel, getVoices: () => [{ lang: 'zh-CN' }], speaking: false, pending: false },
  });
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );
  const h = headless();
  h.place(0, 0, 0);
  const npc = new NpcFighter(npcBattles(h.ctx), h.physics, new Vector3(2, 0, 0));
  const synth = {
    speechVolume: 0.8,
    load: vi.fn(),
    dialogue: speak.mockReturnValue(cancel),
  } as unknown as Synth;
  const voices = new NpcVoices(h.ctx, synth);
  voices.update(0.3);
  expect(speak).toHaveBeenCalledTimes(1);
  voices.update(65);
  expect(speak).toHaveBeenCalledTimes(1);
  h.place(10, 0, 0);
  voices.update(0.3);
  h.place(0, 0, 0);
  npc.damage(100);
  voices.update(0.3);
  expect(speak).toHaveBeenCalledTimes(1);
  npc.hp = 60;
  npc.down = 0;
  voices.update(0.3);
  expect(speak).toHaveBeenCalledTimes(2);
  expect(speak.mock.calls[0]![0]).not.toBe(speak.mock.calls[1]![0]);
  Object.assign(synth, { speechVolume: 0 });
  voices.update(0.3);
  expect(cancel).toHaveBeenCalled();
  voices.dispose();
  npc.dispose();
});

it('ships every voice and line referenced by the runtime catalogue', () => {
  expect(catalogue.voices).toHaveLength(4);
  expect(catalogue.lines).toHaveLength(12);
  for (let i = 0; i < catalogue.voices.length; i++)
    for (const line of catalogue.lines) {
      expect(existsSync(new URL(`../public/sounds/voices/${i}-${line.id}.mp3`, import.meta.url))).toBe(true);
    }
});

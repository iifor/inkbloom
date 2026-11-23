import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/systems/figures/quaternius-courier', () => ({ loadCourier: load }));
import { CharacterModelSelection } from '@/systems/figures/character-model-selection';
afterEach(() => {
  vi.unstubAllGlobals();
  load.mockReset();
});
it('ignores an old outfit download after selection changes, and all results after disposal', async () => {
  vi.stubGlobal('window', {});
  let finishOld!: (s: THREE.Group) => void, finishNew!: (s: THREE.Group) => void;
  load.mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)));
  load.mockImplementationOnce(() => new Promise((resolve) => (finishNew = resolve)));
  const selection = new CharacterModelSelection(),
    publish = vi.fn();
  selection.select('worker', publish);
  selection.select('king', publish);
  const old = new THREE.Group(),
    next = new THREE.Group();
  finishNew(next);
  await Promise.resolve();
  finishOld(old);
  await Promise.resolve();
  expect(publish.mock.calls.map((c) => c[0])).toEqual([null, null, next]);
  selection.select('king', publish);
  expect(load).toHaveBeenCalledTimes(2);
  let after!: (s: THREE.Group) => void;
  load.mockImplementationOnce(() => new Promise((resolve) => (after = resolve)));
  selection.select('beach', publish);
  selection.dispose();
  after(new THREE.Group());
  await Promise.resolve();
  expect(publish.mock.calls.map((c) => c[0])).toEqual([null, null, next, null]);
});

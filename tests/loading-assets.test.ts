import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    loadAsync = load;
  },
}));
import { loadCourier } from '@/systems/figures/quaternius-courier';
import { Synth } from '@/engine/audio/synth';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('reports the selected character download but waits for parsed content before completing', async () => {
  let parsed!: (value: { scene: THREE.Group }) => void;
  load.mockImplementation((_url, progress) => {
    progress({ loaded: 100, total: 100 });
    return new Promise((resolve) => {
      parsed = resolve;
    });
  });
  const progress = vi.fn();
  let ready = false;
  const pending = loadCourier('gardener', progress).then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(load.mock.lastCall?.[0]).toContain('rogue.glb');
  expect(progress.mock.lastCall?.[0]).toBe(0.9);
  expect(ready).toBe(false);
  parsed({ scene: new THREE.Group() });
  await pending;
  expect(progress.mock.lastCall?.[0]).toBe(1);
  const calls = load.mock.calls.length;
  const cached = vi.fn();
  await loadCourier('gardener', cached);
  expect(load).toHaveBeenCalledTimes(calls);
  expect(cached).toHaveBeenLastCalledWith(1);
});

it('counts sound takes only after decoding or selecting their fallback', async () => {
  let decode!: (buffer: AudioBuffer) => void;
  const context = {
    decodeAudioData: () =>
      new Promise<AudioBuffer>((resolve) => {
        decode = resolve;
      }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: url === 'ok', arrayBuffer: async () => new ArrayBuffer(1) })),
  );
  const synth = new Synth();
  const settled = vi.fn();
  const done = synth.load('test', ['ok', 'missing'], context as unknown as BaseAudioContext, settled);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toHaveBeenCalledTimes(1);
  decode({} as AudioBuffer);
  await done;
  expect(settled).toHaveBeenCalledTimes(2);
});

import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { Steam } from '@/engine/render/steam';
import { WakeField } from '@/engine/render/wake-field';
import { warmShaders } from '@/engine/render/warm-up';
import { SunShadows } from '@/engine/render/sun-shadows';
import type { InkRenderer } from '@/engine/render/renderer';

it('keeps all character probes until asynchronous preparation finishes, then removes them', async () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  const variants = new Set<string>();
  const renderer = {
    scene,
    camera,
    async prepareShaders() {
      await Promise.resolve();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const paint = (object.material as THREE.ShaderMaterial).defines.CHARACTER_PAINT !== undefined;
        const joints =
          object instanceof THREE.SkinnedMesh
            ? object.geometry.getAttribute('skinIndex').array.constructor.name
            : 'rigid';
        variants.add(`${paint ? 'character' : 'plain'}:${joints}`);
      });
    },
  };
  const preparation = warmShaders(renderer as unknown as InkRenderer, vi.fn(), async () => {});
  expect(camera.children.length).toBeGreaterThan(0);
  await preparation;
  for (const kind of ['character', 'plain'])
    for (const joints of ['rigid', 'Uint8Array', 'Uint16Array'])
      expect(variants.has(`${kind}:${joints}`)).toBe(true);
  expect(scene.children).toEqual([camera]);
  expect(camera.children).toHaveLength(0);
});

it('prepares both steam programs without enabling an absent source', () => {
  const render = vi.fn();
  const renderer = { render } as unknown as THREE.WebGLRenderer;
  const camera = new THREE.PerspectiveCamera();
  for (const chimney of [false, true]) {
    const steam = new Steam(new THREE.Texture(), chimney);
    steam.warmUp(renderer, camera);
    expect(render).toHaveBeenCalledTimes(1);
    steam.render(renderer, camera, 10, 0);
    expect(render).toHaveBeenCalledTimes(1);
    steam.set([{ x: 0, y: 1, z: 0, r: 2 }], 1, 0, 0);
    steam.render(renderer, camera, 11, 0);
    expect(render).toHaveBeenCalledTimes(2);
    steam.dispose();
    render.mockClear();
  }
});

it('removes temporary probes if asynchronous compilation fails', async () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  const renderer = {
    scene,
    camera,
    prepareShaders: async () => {
      throw new Error('context lost');
    },
  } as unknown as InkRenderer;
  await expect(warmShaders(renderer, vi.fn(), async () => {})).rejects.toThrow('context lost');
  expect(scene.children).toEqual([camera]);
  expect(camera.children).toHaveLength(0);
});

it('precompiles shadow variants and restores scene materials even when compilation fails', async () => {
  const shadows = new SunShadows();
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const geometry = new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  const target = new THREE.WebGLRenderTarget(2, 2);
  const setRenderTarget = vi.fn();
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget,
    compileAsync: async () => {
      expect(mesh.material).not.toBe(material);
      await Promise.resolve();
      throw new Error('context lost');
    },
  } as unknown as THREE.WebGLRenderer;
  await expect(shadows.prepare(renderer, scene)).rejects.toThrow('context lost');
  expect(mesh.material).toBe(material);
  expect(setRenderTarget).toHaveBeenLastCalledWith(target);
  shadows.dispose();
  material.dispose();
  geometry.dispose();
  target.dispose();
});

it('prepares the ripple target without adding a wake or changing the render target', () => {
  const target = new THREE.WebGLRenderTarget(2, 2);
  const render = vi.fn();
  const setRenderTarget = vi.fn();
  const renderer = {
    render,
    setRenderTarget,
    getRenderTarget: () => target,
  } as unknown as THREE.WebGLRenderer;
  const wakes = new WakeField();
  wakes.warmUp(renderer);
  expect(setRenderTarget).toHaveBeenLastCalledWith(target);
  expect(render).toHaveBeenCalledTimes(1);
  expect(wakes.render(renderer, new THREE.Vector3(), 10)).toBe(false);
  expect(render).toHaveBeenCalledTimes(1);
  wakes.add(0, 0, 10, true, 1);
  expect(wakes.render(renderer, new THREE.Vector3(), 10.1)).toBe(true);
  expect(render).toHaveBeenCalledTimes(2);
  expect(wakes.render(renderer, new THREE.Vector3(), 13)).toBe(false);
  wakes.dispose();
  target.dispose();
});

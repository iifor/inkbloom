import * as THREE from 'three';
import { expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { PhysicsWorld } from '@/engine/physics/world';
import type { GameContext } from '@/game/types';
import { PlayerSystem } from '@/systems/player/player';
import { WATER_LEVEL } from '@/world/wilderness/generator';

it.each([false, true])('crosses both banks through wading and swimming with sprint=%s', (sprint) => {
  const heightAt = (x: number) => Math.min(0.4, Math.abs(x) * 0.25 - 3.2);
  const physics = new PhysicsWorld(4);
  physics.ground = heightAt;
  const ctx = {
    wilderness: { heightAt },
    scenes: { active: { ref: { kind: 'wild' }, physics } },
    input: {
      takeLook: () => ({ yaw: 0, pitch: 0 }),
      held: (key: string) => key === 'forward' || (key === 'sprint' && sprint),
      pressed: () => false,
    },
    combat: { alive: true },
    state: { inventory: { glider: true } },
    events: { emit() {} },
    renderer: { camera: new THREE.PerspectiveCamera() },
  };
  const p = new PlayerSystem(ctx as unknown as GameContext);
  p.teleport(new THREE.Vector3(-16, heightAt(-16), 0), -Math.PI / 2);
  const transitions: string[] = [];
  let checkedDeep = false;
  for (let i = 0; i < 1000 && p.position.x < 16; i++) {
    p.update(1 / 60);
    if (transitions.at(-1) !== p.waterMode) transitions.push(p.waterMode);
    if (Math.abs(p.position.x) < 0.1) {
      expect(p.speed).toBeCloseTo(TUNING.player.swimSpeed * (sprint ? 1.25 : 1));
      expect(p.position.y).toBeGreaterThan(heightAt(p.position.x) + 1);
      expect(p.eye.y).toBeGreaterThan(WATER_LEVEL);
      expect(p.gliding).toBe(false);
      checkedDeep = true;
    }
  }
  expect(transitions).toEqual(['dry', 'wading', 'swimming', 'wading', 'dry']);
  expect(checkedDeep).toBe(true);
  expect(p.speed).toBeCloseTo(sprint ? TUNING.player.sprintSpeed : TUNING.player.walkSpeed);
  p.dispose();
});

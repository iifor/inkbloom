// The character on the character select screen: the chosen look standing in the real world a
// few metres in front of the camera, right of the menu card, in the same light and brush pass
// as the game. It turns slowly to show its silhouette and hops when the look changes. Runs on
// its own animation frame while shown, since the menu is up and nothing else drives it.
import * as THREE from 'three';
import '@/shell/character-motion-preview.css';
import type { Look } from '@/content/characters';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { daylightAt } from '@/engine/render/daylight';
import type { GameContext } from '@/game/types';
import { PlayerFigures } from './player-figure';
import { ACTION_SECONDS } from './player-hold';
import { loadCourier } from './quaternius-courier';
import { spawnStoneDistance } from '@/world/wilderness/spawn-circle';

const ACTS = {
  idle: '待机',
  walk: '行走',
  jog: '慢跑',
  run: '奔跑',
  jump: '跳跃',
  brush: '画笔',
  slash: '挥刀',
  shoot: '射击',
  glide: '滑翔',
  swim: '游泳',
} as const;
type PreviewAct = keyof typeof ACTS;

const DISTANCE = 3.1;
/** How far right of the view's centre it stands, so the menu card on the left leaves it clear. */
const SIDE = 1.1;
const HOP = 0.4;

export class CharacterPreview {
  private readonly group = new THREE.Group();
  private readonly material = makeInkMaterial({ cloth: true });
  private readonly figures = new PlayerFigures(this.group, this.material);
  private look: Look | null = null;
  private readonly at = new THREE.Vector3();
  private facing = 0;
  private t = 0;
  private actionT = 0;
  private walkPhase = 0;
  private stride = 0;
  private lift = 0;
  private hopT = 0;
  private frame = 0;
  private act: PreviewAct = 'idle';
  private turn = 0;
  private controls: HTMLElement | null = null;
  private savedPitch = 0;
  private savedYaw = 0;
  private cameraWasVisible = true;
  private savedFov = 78;

  constructor(private readonly ctx: GameContext) {}

  /** Show `look`, or hide the preview with null. */
  show(look: Look | null): void {
    if (!look) {
      this.hide();
      return;
    }
    if (!this.look) {
      this.savedPitch = this.ctx.player.pitch;
      this.savedYaw = this.ctx.player.yaw;
      this.cameraWasVisible = this.ctx.renderer.camera.visible;
      this.savedFov = this.ctx.renderer.baseFov;
      this.ctx.renderer.setFov(52);
      this.ctx.player.pitch = -0.28;
      const { hour, declination } = this.ctx.renderer.atmosphere;
      const light = daylightAt(hour, declination).dir;
      this.ctx.player.yaw = Math.atan2(light.x, light.z);
      // Camera children are first-person hands/weapons, which obscure the figure being inspected.
      this.ctx.renderer.camera.visible = false;
      this.place();
    } else if (look.character !== this.look.character || look.accent !== this.look.accent) this.hopT = HOP;
    this.look = look;
    this.showControls();
    if (!this.frame) {
      let last = performance.now();
      const tick = (now: number): void => {
        this.update(Math.min(0.1, (now - last) / 1000));
        last = now;
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    }
  }

  private showControls(): void {
    if (this.controls) return;
    const panel = document.createElement('section');
    panel.className = 'character-motion-preview';
    panel.setAttribute('aria-label', '角色动作预览');
    panel.innerHTML = `<span data-status>动作预览</span><div>${Object.entries(ACTS)
      .map(
        ([key, label]) =>
          `<button type="button" data-motion="${key}" aria-pressed="${key === this.act}">${label}</button>`,
      )
      .join('')}</div>
      <label>转身 <input aria-label="角色转身" type="range" min="-180" max="180" value="0"></label>`;
    panel.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.onclick = () => {
        this.act = button.dataset.motion as PreviewAct;
        this.actionT = 0;
        panel.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      };
    });
    panel.querySelector<HTMLInputElement>('input')!.oninput = (e) => {
      this.turn = (Number((e.target as HTMLInputElement).value) * Math.PI) / 180;
    };
    document.querySelector('#app')!.append(panel);
    this.controls = panel;
    const status = panel.querySelector<HTMLElement>('[data-status]')!;
    status.textContent = '信使模型载入中…';
    void loadCourier()
      .then(() => {
        status.textContent = '动作预览 · 拖动滑杆查看侧面和背面';
      })
      .catch(() => {
        status.textContent = '信使模型未加载，当前显示原有角色；刷新可重试';
      });
  }

  private place(): void {
    const cam = this.ctx.renderer.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    this.at.copy(cam.position).addScaledVector(fwd, DISTANCE).addScaledVector(right, SIDE);
    this.at.y = this.groundAt(this.at.x, this.at.z);
    // face the camera
    this.facing = Math.atan2(-(cam.position.x - this.at.x), -(cam.position.z - this.at.z));
  }

  /** Whatever it would stand on: the ground, a street, a step; looked for from above. */
  private groundAt(x: number, z: number): number {
    const top = this.ctx.renderer.camera.position.y + 4;
    const hit = this.ctx.scenes.active.physics.raycast({ x, y: top, z }, { x: 0, y: -1, z: 0 }, 30);
    const ground = hit ? hit.point.y : this.ctx.player.position.y;
    // The spawn paving is drawn above the terrain but has no separate physics surface.
    if (this.ctx.scenes.active.ref.kind === 'wild' && spawnStoneDistance(x, z) < -0.24)
      return Math.max(ground, this.ctx.wilderness.heightAt(x, z) + 0.13);
    return ground;
  }

  private update(dt: number): void {
    if (!this.look) return;
    // Opening the menu can precede the player's first camera update after spawning.
    this.place();
    const root = this.ctx.scenes.active.root;
    if (this.group.parent !== root) root.add(this.group);
    this.t += dt;
    this.actionT += dt;
    this.hopT = Math.max(0, this.hopT - dt);
    const hop = this.hopT > 0 ? Math.sin((1 - this.hopT / HOP) * Math.PI) : 0;
    const targetStride = this.act === 'run' ? 1.7 : this.act === 'jog' ? 1.25 : this.act === 'walk' ? 1 : 0;
    this.stride = THREE.MathUtils.lerp(this.stride, targetStride, 1 - Math.exp(-12 * dt));
    const stride = this.stride;
    // Integrate cadence: multiplying elapsed time by a changed speed jumps to another footstep.
    this.walkPhase +=
      dt * (this.act === 'swim' ? 4.2 : (6 + 3 * Math.max(0, (stride - 1) / 0.7)) * Math.min(1, stride));
    const jump = this.act === 'jump' ? Math.max(0, Math.sin(this.actionT * 3.2)) : 0;
    this.lift = THREE.MathUtils.lerp(
      this.lift,
      // Dry-land inspection must leave room below the swimmer for the underwater pull.
      jump * 0.65 + (this.act === 'swim' ? 0.65 : this.act === 'glide' ? 0.5 : 0),
      1 - Math.exp(-16 * dt),
    );
    const held =
      this.act === 'brush'
        ? 'brush'
        : this.act === 'slash'
          ? 'katana'
          : this.act === 'shoot'
            ? 'rifle'
            : null;
    const phase = held
      ? (Math.max(0, this.actionT - 0.25) % (ACTION_SECONDS[held].attack + (held === 'rifle' ? 0 : 0.65))) /
        ACTION_SECONDS[held].attack
      : 0;
    this.figures.begin();
    this.figures.draw(this.look, {
      x: this.at.x,
      y: this.at.y + hop * 0.35 + this.lift,
      z: this.at.z,
      // turn slowly to each side and back, so the hat and hair read from more than the front
      yaw: this.facing + this.turn + Math.sin(this.t * 0.6) * 0.12,
      pitch: Math.sin(this.t * 0.9) * 0.15,
      walk: this.walkPhase,
      stride,
      air: hop > 0 || jump > 0,
      glide: this.act === 'glide',
      swim: this.act === 'swim',
      held,
      paint: this.act === 'brush' ? 1 : 0,
      aim: this.act === 'shoot' ? 1 : 0,
      action: held && held !== 'brush' && phase < 1 ? { kind: 'attack', t: phase } : null,
      hurt: 0,
      dying: -1,
      t: this.t,
    });
    this.figures.end();
  }

  private hide(): void {
    if (this.look) {
      this.ctx.player.pitch = this.savedPitch;
      this.ctx.player.yaw = this.savedYaw;
      this.ctx.renderer.camera.visible = this.cameraWasVisible;
      this.ctx.renderer.setFov(this.savedFov);
    }
    this.look = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.group.removeFromParent();
    this.controls?.remove();
    this.controls = null;
    this.turn = 0;
  }

  dispose(): void {
    this.hide();
    this.figures.dispose();
    this.material.dispose();
  }
}

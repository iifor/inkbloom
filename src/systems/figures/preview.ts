// The character on the character select screen: the chosen look standing in the real world a
// few metres in front of the camera, in the same light and brush pass
// as the game. It turns slowly to show its silhouette and hops when the look changes. Runs on
// its own animation frame while shown, since the menu is up and nothing else drives it.
import * as THREE from 'three';
import '@/shell/character-motion-preview.css';
import { characterDef, characterModel, defaultLook, type Look } from '@/content/characters';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { daylightAt } from '@/engine/render/daylight';
import type { GameContext } from '@/game/types';
import { PlayerFigures } from './player-figure';
import { ACTION_SECONDS } from './player-hold';
import { loadCourier } from './quaternius-courier';
import { FirstPersonPreview } from './preview-first-person';
import { spawnStoneDistance } from '@/world/wilderness/spawn-circle';
import {
  KayKitVillager,
  loadVillager,
  VILLAGER_MOTIONS,
  type VillagerModel,
  type VillagerMotion,
} from './kaykit-villager';

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
type PreviewAct = keyof typeof ACTS | VillagerMotion;

const DISTANCE = 3.1;
const BODY_CENTER = 0.9;
const HOP = 0.4;
type Perspective = 'first' | 'third';

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
  private perspective: Perspective = 'third';
  private firstPerson: FirstPersonPreview | null = null;
  private controls: HTMLElement | null = null;
  private stageObserver: ResizeObserver | null = null;
  private savedPitch = 0;
  private savedYaw = 0;
  private cameraWasVisible = true;
  private savedFov = 78;
  private villagerKey: VillagerModel | null = null;
  private villager: KayKitVillager | null = null;
  private villagerGeneration = 0;

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'third-person-motion-preview';
  }

  /** Show `look`, or hide the preview with null. */
  show(look: Look | null): void {
    this.clearVillager();
    if (!look) {
      this.hide();
      return;
    }
    if (!this.look) {
      this.savedPitch = this.ctx.player.pitch;
      this.savedYaw = this.ctx.player.yaw;
      this.cameraWasVisible = this.ctx.renderer.camera.visible;
      this.savedFov = this.ctx.renderer.baseFov;
      this.applyPerspective();
      const { hour, declination } = this.ctx.renderer.atmosphere;
      const light = daylightAt(hour, declination).dir;
      this.ctx.player.yaw = Math.atan2(light.x, light.z);
      // Camera children are first-person hands/weapons, which obscure the figure being inspected.
      this.ctx.renderer.camera.visible = false;
      this.place();
    } else if (look.character !== this.look.character || look.accent !== this.look.accent) this.hopT = HOP;
    this.look = look;
    this.firstPerson?.setLook(look);
    this.showControls();
    const status = this.controls!.querySelector<HTMLElement>('[data-status]')!;
    if (characterModel(look.character)) {
      status.textContent = `${characterDef(look.character).name}模型载入中…`;
      void loadCourier(look.character)
        .then(() => {
          if (!this.villagerKey && this.look?.character === look.character) status.textContent = '动作预览';
        })
        .catch(() => {
          if (!this.villagerKey && this.look?.character === look.character)
            status.textContent = '模型未加载，显示备用外观；重新选择可重试';
        });
    } else status.textContent = '动作预览';
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

  /** Read-only village model preview, independent of the player's saved look. */
  showVillager(key: VillagerModel): void {
    this.show(defaultLook('courier'));
    this.villagerKey = key;
    this.act = 'idle';
    this.firstPerson?.dispose();
    this.firstPerson = null;
    this.figures.begin();
    this.figures.end();
    this.controls?.remove();
    this.controls = null;
    this.showControls();
    const generation = ++this.villagerGeneration;
    const status = this.controls!.querySelector<HTMLElement>('[data-status]')!;
    status.textContent = '村民模型载入中…';
    void loadVillager(key)
      .then((source) => {
        if (generation !== this.villagerGeneration || this.villagerKey !== key) return;
        this.villager = new KayKitVillager(source);
        this.ctx.renderer.scene.add(this.villager.root);
        status.textContent = '村民原版动作';
      })
      .catch(() => {
        if (generation === this.villagerGeneration) status.textContent = '村民模型加载失败，重新选择可重试';
      });
  }

  private clearVillager(): void {
    if (!this.villagerKey) return;
    this.villagerGeneration++;
    this.villager?.dispose();
    this.villager = null;
    this.villagerKey = null;
    this.act = 'idle';
    this.controls?.remove();
    this.controls = null;
  }

  private showControls(): void {
    if (this.controls) return;
    const panel = document.createElement('section');
    panel.className = 'character-motion-preview';
    panel.setAttribute('aria-label', '角色动作预览');
    panel.innerHTML = `<div class="preview-heading">
      <span data-status>动作预览</span>
      <div role="group" aria-label="预览视角">
        <button type="button" data-perspective="first" aria-pressed="${this.perspective === 'first'}">第一人称</button>
        <button type="button" data-perspective="third" aria-pressed="${this.perspective === 'third'}">第三人称</button>
      </div>
      </div><div role="group" aria-label="动作">${(this.villagerKey
        ? Object.entries(VILLAGER_MOTIONS).map(([key, value]) => [key, value.label])
        : Object.entries(ACTS)
      )
        .map(
          ([key, label]) =>
            `<button type="button" data-motion="${key}" aria-pressed="${key === this.act}">${label}</button>`,
        )
        .join('')}</div>
      <label data-turn ${this.perspective === 'first' ? 'hidden' : ''}>转身 <input aria-label="角色转身" type="range" min="-180" max="180" value="0"></label>`;
    const motions = panel.querySelectorAll<HTMLButtonElement>('[data-motion]');
    motions.forEach((button) => {
      button.onclick = () => {
        this.act = button.dataset.motion as PreviewAct;
        this.actionT = 0;
        motions.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      };
    });
    const views = panel.querySelectorAll<HTMLButtonElement>('[data-perspective]');
    views.forEach((button) => {
      button.onclick = () => {
        this.perspective = button.dataset.perspective as Perspective;
        this.applyPerspective();
        views.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
        panel.querySelector<HTMLElement>('[data-turn]')!.hidden = this.perspective === 'first';
      };
    });
    panel.querySelector<HTMLInputElement>('input')!.oninput = (e) => {
      this.turn = (Number((e.target as HTMLInputElement).value) * Math.PI) / 180;
    };
    this.controls = panel;
  }

  mount(stage: HTMLElement, controls: HTMLElement): void {
    const renderer = this.ctx.renderer;
    stage.append(renderer.renderer.domElement);
    if (this.controls) controls.append(this.controls);
    this.stageObserver ??= new ResizeObserver(() => renderer.resize());
    this.stageObserver.disconnect();
    this.stageObserver.observe(stage);
  }

  private applyPerspective(): void {
    const first = this.perspective === 'first';
    this.ctx.renderer.setFov(first ? this.savedFov : 52);
    this.ctx.player.pitch = first ? -0.08 : -0.25;
    this.group.visible = !first;
    if (this.firstPerson) this.firstPerson.root.visible = first;
  }

  private place(): void {
    const cam = this.ctx.renderer.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
    this.at.copy(cam.position).addScaledVector(fwd, DISTANCE);
    this.at.y = this.groundAt(this.at.x, this.at.z);
    this.ctx.player.pitch = Math.atan2(this.at.y + BODY_CENTER - cam.position.y, DISTANCE);
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
    if (this.villagerKey) {
      if (!this.villager) return;
      const first = this.perspective === 'first',
        root = this.villager.root;
      this.villager.previewMotion(this.act as VillagerMotion, first, dt);
      if (first) {
        const camera = this.ctx.renderer.camera;
        root.quaternion
          .copy(camera.quaternion)
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
        root.position.set(0, -0.88, -0.55).applyQuaternion(camera.quaternion).add(camera.position);
      } else {
        this.place();
        root.position.copy(this.at);
        root.rotation.set(0, this.facing + this.turn + Math.PI, 0);
      }
      return;
    }
    // Opening the menu can precede the player's first camera update after spawning.
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
    if (this.perspective === 'first') {
      if (!this.firstPerson) {
        this.firstPerson = new FirstPersonPreview(this.look);
        this.ctx.renderer.scene.add(this.firstPerson.root);
      }
      this.firstPerson.update(dt, this.ctx.renderer.camera, {
        stride,
        held,
        phase,
        lift: this.lift,
        air: hop > 0 || jump > 0,
        glide: this.act === 'glide',
        swim: this.act === 'swim',
      });
      return;
    }
    this.place();
    const root = this.ctx.scenes.active.root;
    if (this.group.parent !== root) root.add(this.group);
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
    if (this.stageObserver) {
      this.stageObserver.disconnect();
      this.stageObserver = null;
      document.querySelector('#app')!.prepend(this.ctx.renderer.renderer.domElement);
      this.ctx.renderer.resize();
    }
    this.clearVillager();
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
    this.firstPerson?.dispose();
    this.firstPerson = null;
    this.controls?.remove();
    this.controls = null;
    this.turn = 0;
    this.perspective = 'third';
    this.act = 'idle';
    this.stride = this.lift = this.hopT = 0;
  }

  dispose(): void {
    this.hide();
    this.figures.dispose();
    this.material.dispose();
  }
}

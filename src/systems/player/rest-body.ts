import * as THREE from 'three';
import type { Look } from '@/content/characters';
import { makeInkMaterial, shared } from '@/engine/render/ink-material';
import { PlayerFigures, type PlayerPose } from '@/systems/figures/player-figure';

type RestPose = NonNullable<PlayerPose['rest']>;
const eyeFrame = new THREE.Euler(0, 0, 0, 'YXZ');

/** Neck-relative first-person eye, clear of collars even at the downward look limit. */
export function restEyePosition(out: THREE.Vector3, head: THREE.Vector3, yaw: number, rest: RestPose): void {
  const amount = rest.sitting + rest.lying;
  const lying = amount > 0 ? rest.lying / amount : 0;
  eyeFrame.set(rest.groundPitch * amount, yaw, rest.groundRoll * amount);
  out
    .set(0, 0.46 + 0.04 * lying, -0.38 + 0.04 * lying)
    .applyEuler(eyeFrame)
    .add(head);
}

/** Fade the entire local body together so isolated feet cannot remain in view.
 * Coverage preserves the G-buffer's encoded normals without alpha blending. */
function restMaterial(): THREE.ShaderMaterial {
  const material = makeInkMaterial({ cloth: true });
  material.uniforms.uLocalRestFade = { value: 0 };
  material.fragmentShader = `uniform float uLocalRestFade;\n${material.fragmentShader}`.replace(
    'void main() {',
    `void main() {
      float coverage = 1.0 - smoothstep(0.0, 0.65, uLocalRestFade);
      // Fixed screen-space coverage: no animated noise or transparent depth sorting.
      float restGrain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (coverage <= restGrain) discard;`,
  );
  return material;
}

/** The local player's world-space body for the seated and supine first-person views. */
export class RestBody {
  private readonly root = new THREE.Group();
  private readonly material = restMaterial();
  private readonly figures = new PlayerFigures(this.root, this.material, true);
  private readonly head = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.root.name = 'resting-player';
    scene.add(this.root);
  }

  draw(
    dt: number,
    look: Look,
    position: THREE.Vector3,
    yaw: number,
    rest: NonNullable<PlayerPose['rest']>,
  ): void {
    this.time += dt;
    this.root.visible = true;
    this.material.uniforms.uLocalRestFade!.value = rest.sitting + rest.lying;
    this.figures.begin();
    this.figures.draw(
      look,
      {
        x: position.x,
        y: position.y,
        z: position.z,
        yaw,
        pitch: 0,
        walk: 0,
        stride: 0,
        air: false,
        glide: false,
        hurt: 0,
        dying: -1,
        t: this.time,
        rest,
      },
      this.head,
    );
    this.figures.end();
    shared.uRestArea.value.set(position.x, position.y, position.z, rest.sitting + rest.lying);
    shared.uRestDirection.value.set(Math.sin(yaw), Math.cos(yaw));
  }

  /** Stay in front of the open collar, using the selected character's actual posed neck. */
  adjustEye(out: THREE.Vector3, yaw: number, rest: NonNullable<PlayerPose['rest']>): void {
    const amount = rest.sitting + rest.lying;
    if (!this.root.visible || amount <= 0) return;
    restEyePosition(this.eye, this.head, yaw, rest);
    out.lerp(this.eye, amount);
  }

  hide(): void {
    shared.uRestArea.value.w = 0;
    if (!this.root.visible) return;
    this.root.visible = false;
    this.figures.begin();
    this.figures.end();
  }

  dispose(): void {
    shared.uRestArea.value.w = 0;
    this.root.removeFromParent();
    this.figures.dispose();
    this.material.dispose();
  }
}

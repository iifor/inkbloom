import * as THREE from 'three';
import { PALETTE } from '@/content/palette';
import type { Vec3Like } from '@/engine/physics/world';
import { shared } from './ink-material';
import { OVERLAY_DEPTH } from './precipitation';

/** A light, continuous pigment mist from the visible brush tip to the wall. */
export class BrushSpray {
  private readonly scene = new THREE.Scene();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly uniforms = {
    uDepth: { value: null as THREE.Texture | null },
    uReversedDepth: shared.uReversedDepth,
    uRes: { value: new THREE.Vector2() },
    uNear: { value: 0.08 },
    uFar: { value: 500 },
    uTime: { value: 0 },
    uScale: { value: 600 },
    uLight: { value: 1 },
    uFrom: { value: new THREE.Vector3() },
    uTo: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color() },
  };
  private readonly material: THREE.ShaderMaterial;
  private active = false;

  constructor(depth: THREE.Texture) {
    this.uniforms.uDepth.value = depth;
    const count = 72;
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) seeds.set([(i * 0.618034) % 1, (i * 0.754878) % 1, i / count], i * 3);
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seeds, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec3 uFrom, uTo;
        uniform float uTime, uScale;
        varying float vDepth, vAlpha;
        void main() {
          // Each seed travels outward in about a quarter of a second. The cone
          // opens gently and ends at the hit, never on the far side of the wall.
          float age = fract(position.z + uTime * 4.0);
          float t = age * 0.98;
          vec3 along = normalize(uTo - uFrom);
          vec3 up = abs(along.y) > 0.95 ? vec3(1, 0, 0) : vec3(0, 1, 0);
          vec3 side = normalize(cross(along, up));
          up = cross(side, along);
          float angle = position.x * 6.283185 + age * 0.9;
          float spread = (0.006 + 0.075 * t) * sqrt(position.y);
          vec3 p = mix(uFrom, uTo, t) + spread * (side * cos(angle) + up * sin(angle));
          vec4 view = viewMatrix * vec4(p, 1.0);
          vDepth = -view.z;
          vAlpha = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.75, 1.0, age));
          gl_Position = projectionMatrix * view;
          gl_PointSize = clamp(uScale * (0.023 + age * 0.085) / max(vDepth, 0.1), 1.0, 52.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${OVERLAY_DEPTH}
        uniform vec3 uColor;
        uniform float uLight;
        varying float vAlpha;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float soft = exp(-dot(p, p) * 20.0) * (1.0 - smoothstep(0.35, 0.5, length(p)));
          float alpha = soft * vAlpha * 0.12 * visible();
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(uColor * uLight, alpha);
        }`,
    });
    const mist = new THREE.Points(this.geometry, this.material);
    mist.frustumCulled = false;
    this.scene.add(mist);
  }

  update(dt: number, from: Vec3Like, to: Vec3Like, color: number): void {
    this.active = true;
    this.uniforms.uTime.value += dt;
    this.uniforms.uFrom.value.copy(from);
    this.uniforms.uTo.value.copy(to);
    const rgb = (PALETTE[color] ?? PALETTE[0]!).rgb;
    this.uniforms.uColor.value.setRGB(rgb[0]!, rgb[1]!, rgb[2]!);
    // A coincident endpoint has no direction and should not produce NaNs in the shader.
    if (this.uniforms.uFrom.value.distanceToSquared(this.uniforms.uTo.value) < 0.0001) this.clear();
  }

  clear(): void {
    this.active = false;
    this.uniforms.uTime.value = 0;
  }

  /** Draw after the painterly pass, depth-tested against walls and the player's hands. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, night: number): void {
    if (!this.active) return;
    const target = renderer.getRenderTarget();
    if (target) this.uniforms.uRes.value.set(target.width, target.height);
    else renderer.getDrawingBufferSize(this.uniforms.uRes.value);
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;
    this.uniforms.uScale.value =
      this.uniforms.uRes.value.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    this.uniforms.uLight.value = 1 - night * 0.45;
    renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

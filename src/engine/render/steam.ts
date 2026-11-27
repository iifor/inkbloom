// Steam rising off hot springs, drawn over the finished frame like the rain (and, like it,
// hidden behind walls and hills): soft white puffs that well up off the water, swell, drift
// downwind and thin away. Thick on a cold morning or a winter night, a faint shimmer on a summer
// afternoon. The atmosphere system says which springs are near and how cold it is.
import * as THREE from 'three';
import { shared } from './ink-material';
import { OVERLAY_DEPTH } from './precipitation';

/** Springs steaming at once (the nearest ones). */
export const STEAM_SPRINGS = 3;
const PUFFS = 70;
export const SMOKE_CHIMNEYS = 10;
const SMOKE_PUFFS = 22;
/** Metres a puff rises before it is gone, and seconds that takes. */
const RISE = 4;
const LIFE = 7;

export interface SteamSource {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Pool radius. */
  readonly r: number;
  readonly opacity?: number;
}

const steamVertex = (sourceCount: number) => /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec4 uSprings[${sourceCount}];
uniform float uOpacity[${sourceCount}];
uniform vec2 uWind;
uniform float uScale;
varying float vDepth;
varying float vAlpha;
void main() {
  int k = int(aSeed.w);
  vec4 s = uSprings[k];
  // each puff loops: wells up at a random spot on the water, rises, swells, drifts and fades
  float offset = fract(dot(s.xz, vec2(0.1031, 0.11369)));
  float age = fract(uTime / ${LIFE.toFixed(1)} + aSeed.z + offset);
  float a = aSeed.x * 6.2832;
  float d = sqrt(aSeed.y) * s.w * 0.8;
  vec3 p = vec3(s.x + cos(a) * d, s.y, s.z + sin(a) * d);
  p.y += age * ${RISE.toFixed(1)};
  p.xz += uWind * age * 0.9 + vec2(sin(uTime * 0.7 + aSeed.x * 20.0), cos(uTime * 0.5 + aSeed.y * 20.0)) * 0.25 * age;
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  vDepth = -view.z;
  // in quickly, out slowly; nothing for an empty slot (radius 0)
  vAlpha = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.45, 1.0, age)) * uOpacity[k];
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(uScale * (0.9 + age * 1.6) / max(vDepth, 0.1), 2.0, 160.0);
}`;

const frag = /* glsl */ `
precision highp float;
${OVERLAY_DEPTH}
uniform float uStrength;
uniform float uLight;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-r * r * 3.0) * vAlpha * uStrength * 0.35 * visible();
  if (a <= 0.004) discard;
  gl_FragColor = vec4(vec3(0.95, 0.96, 0.98) * uLight, a);
}`;

export class Steam {
  private readonly scene = new THREE.Scene();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private strength = 0;
  private any = false;

  constructor(depth: THREE.Texture, chimneySmoke = false) {
    const sourceCount = chimneySmoke ? SMOKE_CHIMNEYS : STEAM_SPRINGS;
    const puffs = chimneySmoke ? SMOKE_PUFFS : PUFFS;
    this.uniforms = {
      uDepth: { value: depth },
      uRes: { value: new THREE.Vector2(2, 2) },
      uNear: { value: 0.1 },
      uFar: { value: 500 },
      uReversedDepth: shared.uReversedDepth,
      uTime: { value: 0 },
      uSprings: { value: Array.from({ length: sourceCount }, () => new THREE.Vector4()) },
      uOpacity: { value: new Float32Array(sourceCount) },
      uWind: { value: new THREE.Vector2() },
      uScale: { value: 600 },
      uStrength: { value: 0 },
      uLight: { value: 1 },
    };
    const n = puffs * sourceCount;
    const seeds = new Float32Array(n * 4);
    let s = 0x1b873593;
    const rand = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    // Reuse each slot's particle seeds so a chimney does not restart when its rank changes.
    const seed = Array.from({ length: puffs }, () => [rand(), rand(), rand()] as const);
    for (let i = 0; i < n; i++) seeds.set([...seed[i % puffs]!, Math.floor(i / puffs)], i * 4);
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: steamVertex(sourceCount),
      fragmentShader: frag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    this.scene.add(points);
  }

  /**
   * The nearby sources, how thick the steam is (colder is thicker), and the wind it drifts on.
   */
  set(springs: readonly SteamSource[], strength: number, windX: number, windZ: number): void {
    const slots = this.uniforms.uSprings!.value as THREE.Vector4[];
    const opacity = this.uniforms.uOpacity!.value as Float32Array;
    slots.forEach((v, i) => {
      const s = springs[i];
      if (s) v.set(s.x, s.y, s.z, s.r);
      else v.set(0, 0, 0, 0);
      opacity[i] = s && s.r > 0.01 ? (s.opacity ?? 1) : 0;
    });
    this.any = springs.length > 0;
    this.strength = strength;
    (this.uniforms.uWind!.value as THREE.Vector2).set(windX, windZ);
  }

  setSize(width: number, height: number): void {
    (this.uniforms.uRes!.value as THREE.Vector2).set(width, height);
  }

  /** Compile and upload while the loading screen is up, even without a nearby source.
   * The initial zero strength/opacity keeps the throwaway draw invisible. */
  async prepare(r: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): Promise<void> {
    await r.compileAsync(this.scene, camera);
  }

  warmUp(r: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    r.render(this.scene, camera);
  }

  render(r: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, time: number, night: number): void {
    if (!this.any || this.strength < 0.01) return;
    const u = this.uniforms;
    u.uNear!.value = camera.near;
    u.uFar!.value = camera.far;
    u.uTime!.value = time;
    u.uStrength!.value = this.strength;
    u.uLight!.value = 1 - 0.65 * night;
    u.uScale!.value = (camera.projectionMatrix.elements[5]! * (u.uRes!.value as THREE.Vector2).y) / 2;
    r.render(this.scene, camera);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

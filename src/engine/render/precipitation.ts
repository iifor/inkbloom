// Rain, snow and lightning, drawn over the painted frame (after the brush pass, which would
// smear thin streaks away; before anti-aliasing). Rain is a few thousand one-pixel streaks and
// snow a few thousand round flakes in a box that rides with the camera: every drop's place is
// a fixed fraction of the box shifted by time and wind and wrapped, so nothing is simulated on
// the CPU. They read the scene's depth to hide behind walls and hills. Lightning bolts are
// jagged lines built once per strike (midpoint displacement with a few branches) that flicker
// out over a quarter of a second.
import * as THREE from 'three';

/** Metres across the box of drops around the camera. */
const BOX = 36;
const RAIN_DROPS = 5000;
const SNOW_FLAKES = 4000;
/** Seconds a bolt stays on screen. */
const BOLT_LIFE = 0.28;
/** Metres a bolt drops from. */
const BOLT_HEIGHT = 150;

export interface PrecipitationLook {
  readonly rain: number;
  readonly snowfall: number;
  readonly windX: number;
  readonly windZ: number;
  /** 0 by day, 1 at night: drops catch less light. */
  readonly night: number;
}

const common = /* glsl */ `
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
varying float vDepth;
float linDepth(float z) { float zn = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - zn * (uFar - uNear)); }
/** 0 where something in the scene is in front of this fragment. */
float visible() {
  float scene = linDepth(texture2D(uDepth, gl_FragCoord.xy / uRes).x);
  return step(vDepth, scene + 0.05);
}`;

/** A drop's place in the box: its own fraction, moved by velocity over time and wrapped. */
const dropPlace = /* glsl */ `
uniform float uTime;
uniform vec3 uVelocity;
uniform float uLevel;
attribute vec4 aSeed;
vec3 dropPlace() {
  vec3 f = fract(aSeed.xyz + uVelocity * uTime / ${BOX.toFixed(1)});
  return cameraPosition + (f - 0.5) * ${BOX.toFixed(1)};
}`;

const rainVert = /* glsl */ `
${dropPlace}
attribute float aEnd;
varying float vDepth;
varying float vFade;
void main() {
  vec3 p = dropPlace();
  // a streak is the drop's path over a short exposure, tail up-wind
  p -= uVelocity * 0.06 * aEnd;
  vec4 view = viewMatrix * vec4(p, 1.0);
  vDepth = -view.z;
  // only part of the drops fall in light rain; fade them out towards the box's edge
  vFade = step(aSeed.w, uLevel) * (1.0 - smoothstep(${(BOX * 0.3).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, length(p - cameraPosition)));
  gl_Position = projectionMatrix * view;
}`;

const rainFrag = /* glsl */ `
precision highp float;
${common}
uniform vec3 uColor;
varying float vFade;
void main() {
  if (vFade <= 0.0) discard;
  gl_FragColor = vec4(uColor, 0.6 * vFade * visible());
}`;

const snowVert = /* glsl */ `
${dropPlace}
uniform float uScale;
varying float vDepth;
varying float vFade;
void main() {
  vec3 p = dropPlace();
  // flakes drift side to side as they fall
  p.x += sin(uTime * 1.3 + aSeed.w * 40.0) * 0.35;
  p.z += cos(uTime * 1.1 + aSeed.x * 40.0) * 0.35;
  vec4 view = viewMatrix * vec4(p, 1.0);
  vDepth = -view.z;
  vFade = step(aSeed.w, uLevel) * (1.0 - smoothstep(${(BOX * 0.3).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, length(p - cameraPosition)));
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(uScale * (0.05 + 0.04 * aSeed.y) / max(vDepth, 0.1), 1.5, 9.0);
}`;

const snowFrag = /* glsl */ `
precision highp float;
${common}
uniform vec3 uColor;
varying float vFade;
void main() {
  if (vFade <= 0.0) discard;
  float r = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.3, 0.5, r)) * 0.9 * vFade * visible();
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const boltVert = /* glsl */ `
varying float vDepth;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

const boltFrag = /* glsl */ `
precision highp float;
${common}
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(0.94, 0.92, 1.0, uAlpha * visible());
}`;

/** Each drop: a random fraction of the box (xyz) and a threshold for how heavy it must rain (w). */
function seeds(count: number, perDrop: number): Float32Array {
  const a = new Float32Array(count * perDrop * 4);
  let s = 0x2545f491;
  const rand = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < count; i++) {
    const v = [rand(), rand(), rand(), rand()];
    for (let k = 0; k < perDrop; k++) a.set(v, (i * perDrop + k) * 4);
  }
  return a;
}

/** A jagged bolt from the sky down to `ground`: line segment pairs, with a few side branches. */
function boltSegments(ground: THREE.Vector3, shape: number): Float32Array {
  let s = shape >>> 0 || 1;
  const rand = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const out: number[] = [];
  const crack = (from: THREE.Vector3, to: THREE.Vector3, levels: number, branchy: boolean): void => {
    let pts = [from.clone(), to.clone()];
    for (let l = 0; l < levels; l++) {
      const next: THREE.Vector3[] = [pts[0]!];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const len = a.distanceTo(b);
        const mid = a.clone().lerp(b, 0.4 + 0.2 * rand());
        mid.x += (rand() - 0.5) * len * 0.5;
        mid.z += (rand() - 0.5) * len * 0.5;
        next.push(mid, b);
        if (branchy && l >= 1 && l <= 3 && rand() < 0.3) {
          const end = mid
            .clone()
            .add(new THREE.Vector3((rand() - 0.5) * len, -len * (0.4 + 0.4 * rand()), (rand() - 0.5) * len));
          crack(mid, end, levels - l - 1, false);
        }
      }
      pts = next;
    }
    for (let i = 1; i < pts.length; i++) out.push(...pts[i - 1]!.toArray(), ...pts[i]!.toArray());
  };
  const top = ground.clone().add(new THREE.Vector3((rand() - 0.5) * 60, BOLT_HEIGHT, (rand() - 0.5) * 60));
  crack(top, ground, 6, true);
  return new Float32Array(out);
}

export class Precipitation {
  private readonly scene = new THREE.Scene();
  private readonly shared: Record<string, THREE.IUniform>;
  private readonly rain: THREE.LineSegments;
  private readonly snow: THREE.Points;
  private readonly rainMat: THREE.ShaderMaterial;
  private readonly snowMat: THREE.ShaderMaterial;
  private readonly bolts: { line: THREE.LineSegments; age: number }[] = [];
  private last = performance.now();

  constructor(depth: THREE.Texture) {
    this.shared = {
      uDepth: { value: depth },
      uRes: { value: new THREE.Vector2(2, 2) },
      uNear: { value: 0.1 },
      uFar: { value: 500 },
    };
    const drops = (frag: string, vert: string, extra: Record<string, THREE.IUniform>): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...this.shared,
          uTime: { value: 0 },
          uVelocity: { value: new THREE.Vector3() },
          uLevel: { value: 0 },
          uColor: { value: new THREE.Color() },
          ...extra,
        },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });

    const rg = new THREE.BufferGeometry();
    // two vertices per streak: head (aEnd 0) and tail (aEnd 1); positions come from the shader
    rg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(RAIN_DROPS * 2 * 3), 3));
    rg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds(RAIN_DROPS, 2), 4));
    rg.setAttribute(
      'aEnd',
      new THREE.Float32BufferAttribute(
        Float32Array.from({ length: RAIN_DROPS * 2 }, (_, i) => i % 2),
        1,
      ),
    );
    this.rainMat = drops(rainFrag, rainVert, {});
    this.rain = new THREE.LineSegments(rg, this.rainMat);

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SNOW_FLAKES * 3), 3));
    sg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds(SNOW_FLAKES, 1), 4));
    this.snowMat = drops(snowFrag, snowVert, { uScale: { value: 600 } });
    this.snow = new THREE.Points(sg, this.snowMat);

    for (const o of [this.rain, this.snow]) {
      o.frustumCulled = false;
      this.scene.add(o);
    }
  }

  /** Lightning lands at `at`; `shape` picks its jagged path. */
  strike(at: THREE.Vector3Like, shape: number): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(boltSegments(new THREE.Vector3(at.x, at.y, at.z), shape), 3),
    );
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.shared, uAlpha: { value: 1 } },
      vertexShader: boltVert,
      fragmentShader: boltFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.LineSegments(g, m);
    line.frustumCulled = false;
    this.scene.add(line);
    this.bolts.push({ line, age: 0 });
  }

  setSize(width: number, height: number): void {
    (this.shared.uRes!.value as THREE.Vector2).set(width, height);
  }

  /** Draws into whatever target is bound, over what is there. */
  render(
    r: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    look: PrecipitationLook,
    time: number,
  ): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.age += dt;
      // a bolt flickers: on, a dip, a second stroke, gone
      const t = b.age / BOLT_LIFE;
      (b.line.material as THREE.ShaderMaterial).uniforms.uAlpha!.value =
        t > 1 ? 0 : (1 - t) * (t > 0.3 && t < 0.45 ? 0.3 : 1);
      if (t > 1) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        (b.line.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
      }
    }
    if (look.rain < 0.01 && look.snowfall < 0.01 && this.bolts.length === 0) return;
    this.shared.uNear!.value = camera.near;
    this.shared.uFar!.value = camera.far;
    const light = 1 - 0.65 * look.night;
    const set = (
      m: THREE.ShaderMaterial,
      level: number,
      fall: number,
      colour: THREE.ColorRepresentation,
    ): void => {
      m.uniforms.uTime!.value = time;
      m.uniforms.uLevel!.value = level;
      (m.uniforms.uVelocity!.value as THREE.Vector3).set(look.windX, -fall, look.windZ);
      (m.uniforms.uColor!.value as THREE.Color).set(colour).multiplyScalar(light);
    };
    set(this.rainMat, look.rain, 11, 0xc4ccdc);
    set(this.snowMat, look.snowfall, 1.4, 0xffffff);
    this.snowMat.uniforms.uScale!.value =
      (camera.projectionMatrix.elements[5]! * (this.shared.uRes!.value as THREE.Vector2).y) / 2;
    this.rain.visible = look.rain >= 0.01;
    this.snow.visible = look.snowfall >= 0.01;
    r.render(this.scene, camera);
  }

  dispose(): void {
    for (const b of this.bolts) {
      b.line.geometry.dispose();
      (b.line.material as THREE.Material).dispose();
    }
    for (const o of [this.rain, this.snow]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
}

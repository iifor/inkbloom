// Ink renderer. The scene is drawn into a G-buffer (see ink-material.ts) plus depth, then one
// full-screen pass draws paper, outlines and world-anchored hatching. Saturation 0 renders as
// a graphite sketch on paper; saturation 1 is a hand-painted animation look: opaque colour with
// warm light and cool shadows, warm brown outlines, a painted sky with cumulus clouds and
// haze in the distance. `atmosphere.gloom` (the ink tide) drains the whole view towards black
// and white and closes it in with ink.
// Ported from doodle-game's render.js; the colour model is new.
import * as THREE from 'three';
import { type ColorDef, MAX_COLORS, PALETTE } from '@/content/palette';
import { disposeTree } from '../resources';
import { shared } from './ink-material';

export const LIGHT_WORLD = new THREE.Vector3(0.38, 0.82, 0.42).normalize();

const postVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const postFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
uniform float uLineSpacing;
uniform vec3 uPaper;
uniform vec3 uGraphite;
uniform vec3 uColors[${MAX_COLORS}];
uniform mat4 uInvProj;
uniform mat4 uInvView;
uniform float uWash;
uniform float uSolid[${MAX_COLORS}];
uniform float uSkySat;
uniform float uGloom;
uniform float uTime;

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
float linDepth(float z) { float zn = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - zn * (uFar - uNear)); }
vec3 paletteColor(float code) {
  int i = int(floor(code + 0.0005));
  vec3 c = uColors[0];
  for (int k = 0; k < ${MAX_COLORS}; k++) if (k == i) c = uColors[k];
  return c;
}
float solidOf(float code) {
  int i = int(floor(code + 0.0005));
  float s = 0.0;
  for (int k = 0; k < ${MAX_COLORS}; k++) if (k == i) s = uSolid[k];
  return s;
}
float satOf(float code) { return clamp(fract(code + 0.0005) / 0.9, 0.0, 1.0); }
float stripes(vec2 p, vec2 dir, float spacing, float width) {
  float t = dot(p, vec2(-dir.y, dir.x));
  float f = abs(fract(t / spacing) - 0.5) * spacing;
  float soft = width * 0.6;
  return 1.0 - smoothstep(width * 0.5 - soft, width * 0.5 + soft, f);
}
vec3 inkOf(float code) {
  // drained ink is graphite; coloured ink is a warm brown leaning towards the surface colour
  vec3 warm = mix(paletteColor(code) * 0.42, vec3(0.27, 0.17, 0.11), 0.45);
  return mix(uGraphite, warm, satOf(code));
}
const vec3 HORIZON = vec3(0.97, 0.93, 0.82);
/** Painted sky along a world-space ray: gradient and cumulus clouds (colour), or the same
 * clouds as pencil outlines on paper (drained). Returns colour; paper is mixed by the caller. */
vec3 skyPaint(vec3 rd, vec3 paper, float sat) {
  float e = rd.y;
  vec3 c = mix(HORIZON, vec3(0.55, 0.77, 0.94), smoothstep(-0.02, 0.22, e));
  c = mix(c, vec3(0.26, 0.52, 0.86), smoothstep(0.22, 0.85, e));
  // a warm glow towards the sun
  c += vec3(0.10, 0.06, 0.0) * pow(max(0.0, dot(rd, normalize(vec3(0.38, 0.35, 0.42)))), 6.0);
  vec2 cuv = rd.xz / (max(e, 0.0) + 0.14) * 1.25 + vec2(uTime * 0.006, uTime * 0.0025);
  float n = fbm(cuv);
  float above = smoothstep(-0.01, 0.12, e);
  // flatter, bigger clouds near the horizon; towering ones higher up
  float thr = mix(0.6, 0.53, smoothstep(0.05, 0.5, e));
  float body = smoothstep(thr, thr + 0.05, n) * above;
  // light from the sun side: brighter where the noise thins towards it
  float n2 = fbm(cuv + vec2(0.05, 0.07));
  float lit = clamp((n - n2) * 7.0 + 0.62, 0.0, 1.0);
  vec3 cloud = mix(vec3(0.64, 0.70, 0.86), vec3(1.0, 0.985, 0.95), lit);
  c = mix(c, cloud, body);
  float rim = (1.0 - smoothstep(0.0, 1.6, abs(n - thr) / max(fwidth(n), 1e-4))) * above;
  vec3 coloured = mix(c, vec3(0.42, 0.36, 0.34), rim * 0.35);
  // drained: paper with the clouds sketched in graphite
  vec3 sketch = mix(paper, uGraphite, rim * 0.55);
  return mix(sketch, coloured, sat);
}

void main() {
  vec2 px = 1.0 / uRes;
  float sc = uRes.y / 900.0;
  vec2 nuv = vUv * vec2(uAspect, 1.0);
  vec2 wob = vec2(vnoise(nuv * 6.0 + 11.3), vnoise(nuv * 6.0 + 37.0)) - 0.5;
  vec2 suv = vUv + wob * 2.0 * sc * px;
  vec4 s = texture2D(tScene, suv);
  float z = texture2D(tDepth, suv).x;
  float d = linDepth(z);
  float o = 1.15 * sc;
  vec2 ox = vec2(o, 0.0) * px, oy = vec2(0.0, o) * px;
  float zl = texture2D(tDepth, suv - ox).x, zr = texture2D(tDepth, suv + ox).x;
  float zu = texture2D(tDepth, suv + oy).x, zd = texture2D(tDepth, suv - oy).x;
  vec4 sl = texture2D(tScene, suv - ox), sr = texture2D(tScene, suv + ox);
  vec4 su = texture2D(tScene, suv + oy), sd = texture2D(tScene, suv - oy);
  // Silhouettes from the second difference of inverse depth (zero on any plane).
  float iw = 1.0 / d;
  float lap = abs(1.0 / linDepth(zl) + 1.0 / linDepth(zr) - 2.0 * iw)
            + abs(1.0 / linDepth(zu) + 1.0 / linDepth(zd) - 2.0 * iw);
  float edge = smoothstep(0.07, 0.30, lap / (iw + 1e-7));
  float nEdge = length(sl.ba - sr.ba) + length(su.ba - sd.ba);
  edge = max(edge, smoothstep(0.42, 0.85, nEdge));
  // colour boundaries between surfaces also get a line
  float cEdge = step(0.5, abs(floor(sl.g) - floor(sr.g)) + abs(floor(su.g) - floor(sd.g)));
  edge = max(edge, cEdge * 0.6);
  float zmin = z; float code = s.g;
  if (zl < zmin) { zmin = zl; code = sl.g; }
  if (zr < zmin) { zmin = zr; code = sr.g; }
  if (zu < zmin) { zmin = zu; code = su.g; }
  if (zd < zmin) { zmin = zd; code = sd.g; }
  float dFront = linDepth(zmin);
  bool sky = z >= 0.99999;

  float shade = s.r;
  float hatch = 0.0;
  if (!sky) {
    vec4 clip = vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
    vec4 vpos = uInvProj * clip; vpos /= vpos.w;
    vec3 wpos = (uInvView * vec4(vpos.xyz, 1.0)).xyz;
    vec2 nxy = s.ba;
    vec3 nView = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
    vec3 wn = normalize(mat3(uInvView) * nView);
    vec3 an = abs(wn);
    vec2 hp; float sp; float w;
    if (d < 2.0) {
      // held tools ride with the camera, so for them the screen is the stable frame
      hp = gl_FragCoord.xy + wob * 5.0 * sc;
      sp = 8.5 * sc; w = 1.5 * sc;
    } else {
      hp = an.y > max(an.x, an.z) ? wpos.xz : (an.x > an.z ? wpos.zy : wpos.xy);
      float lod = exp2(floor(log2(max(1e-4, (0.0165 * d) / 0.16))));
      sp = 0.16 * lod; w = sp * 0.17;
      hp += (vnoise(hp * (2.5 / sp)) - 0.5) * sp * 0.4;
    }
    float h1 = stripes(hp, vec2(0.7071, 0.7071), sp, w);
    float h2 = stripes(hp, vec2(-0.7071, 0.7071), sp * 1.15, w);
    float h3 = stripes(hp, vec2(0.2588, 0.9659), sp * 0.7, w);
    hatch = h1 * smoothstep(0.64, 0.5, shade);
    hatch = max(hatch, h2 * smoothstep(0.42, 0.32, shade));
    hatch = max(hatch, h3 * smoothstep(0.24, 0.14, shade));
    hatch = max(hatch, smoothstep(0.12, 0.0, shade) * 0.9);
  }
  float fade = mix(1.0, 0.28, smoothstep(14.0, 110.0, d));
  float fadeE = mix(1.0, 0.45, smoothstep(30.0, 220.0, dFront));

  vec2 pp = gl_FragCoord.xy;
  float grain = vnoise(pp * 0.8) * 0.6 + vnoise(pp * 0.17) * 0.4;
  vec3 paper = uPaper * (0.95 + 0.06 * grain);
  vec3 plain = paper;
  float ls = uLineSpacing;
  float ly = mod(pp.y + ls * 0.5, ls);
  float rule = 1.0 - smoothstep(0.5 * sc, 1.7 * sc, abs(ly - ls * 0.5));
  paper = mix(paper, vec3(0.58, 0.70, 0.92), rule * 0.35);

  vec3 col = paper;
  float skySat = uSkySat * (1.0 - uGloom);
  if (sky) {
    vec4 cp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 rd = normalize(mat3(uInvView) * normalize(cp.xyz / cp.w));
    col = skyPaint(rd, paper, skySat);
  } else {
    // gouache: opaque colour, warm where the sun falls and cool blue in shadow, a little
    // uneven like a brush; it thins towards paper only far away
    float sat = satOf(s.g);
    float bleed = 0.88 + 0.12 * vnoise(pp * 0.05 + s.g);
    float lightK = smoothstep(0.28, 0.78, shade);
    vec3 wash = paletteColor(s.g) * mix(vec3(0.60, 0.66, 0.86), vec3(1.06, 1.01, 0.93), lightK);
    float wf = uWash * sat * bleed * mix(1.0, 0.7, smoothstep(80.0, 420.0, d));
    // the notebook rules only show through bare paper
    col = mix(paper, plain, sat);
    col = mix(col, wash, wf);
    hatch *= mix(1.0, 0.22, sat);
    // solid ink: no paper showing through, a wet sheen where the light catches it
    float solid = solidOf(s.g) * sat;
    vec3 wet = mix(paletteColor(s.g), vec3(0.36, 0.37, 0.44), pow(shade, 6.0) * 0.55);
    col = mix(col, wet, solid * mix(0.97, 0.7, smoothstep(80.0, 300.0, d)));
  }
  col = mix(col, inkOf(s.g), hatch * 0.6 * fade);
  float ew = 0.75 + 0.35 * vnoise(pp * 0.35);
  col = mix(col, inkOf(code) * 0.92, clamp(edge * ew, 0.0, 1.0) * fadeE);
  if (!sky) {
    // aerial perspective: far things melt into the horizon haze (or the paper, when grey)
    float hz = smoothstep(110.0, 460.0, d) * 0.55;
    col = mix(col, mix(paper, HORIZON, skySat), hz);
  }
  if (uGloom > 0.001) {
    // the ink tide: colour drains out of everything and ink creeps in from the edges
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(lum) * vec3(0.95, 0.96, 1.0), uGloom * 0.82);
    col *= 1.0 - 0.16 * uGloom;
    vec2 q = vUv - 0.5; q.x *= uAspect;
    float blot = (vnoise(pp * 0.006 + uTime * 0.07) - 0.5) * 0.22 + (vnoise(pp * 0.03) - 0.5) * 0.08;
    float vig = smoothstep(0.5, 0.9, length(q) + blot) * uGloom;
    col = mix(col, vec3(0.05, 0.05, 0.08), vig * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class InkRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.08, 480);
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly post: THREE.ShaderMaterial;
  private readonly postScene = new THREE.Scene();
  private readonly postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clearColor = new THREE.Color(1, 0, 0);
  private pixelRatio: number;
  /** The player's field of view; tools zoom relative to it and return to it. */
  baseFov = 78;
  /** Mood of the whole view, set by gameplay each frame. `colour` 0..1 is how much colour
   * is around the camera (the sky follows it); `gloom` 0..1 drains everything to black and
   * white with ink closing in from the edges. */
  readonly atmosphere = { colour: 1, gloom: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) {
      this.renderer.dispose();
      throw new Error('需要支持浮点渲染目标的 WebGL 2');
    }
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      throw new Error(
        [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join(
          '\n',
        ),
      );
    };
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    // count draws across both passes; render() resets once per frame
    this.renderer.info.autoReset = false;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    const depthTexture = new THREE.DepthTexture(2, 2);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.FloatType;
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    const colors = Array.from({ length: MAX_COLORS }, (_, i) => {
      const c = PALETTE[i]?.rgb ?? [1, 0, 1];
      return new THREE.Vector3(c[0], c[1], c[2]);
    });
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture },
        tDepth: { value: depthTexture },
        uRes: { value: new THREE.Vector2(2, 2) },
        uAspect: { value: 1 },
        uNear: { value: this.camera.near },
        uFar: { value: this.camera.far },
        uLineSpacing: { value: 60 },
        uPaper: { value: new THREE.Vector3(0.965, 0.955, 0.905) },
        uGraphite: { value: new THREE.Vector3(0.2, 0.21, 0.25) },
        uColors: { value: colors },
        uSolid: {
          value: Array.from({ length: MAX_COLORS }, (_, i) =>
            (PALETTE[i] as ColorDef | undefined)?.solid ? 1 : 0,
          ),
        },
        uInvProj: { value: new THREE.Matrix4() },
        uInvView: { value: new THREE.Matrix4() },
        uWash: { value: 0.93 },
        uSkySat: { value: 1 },
        uGloom: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: postVert,
      fragmentShader: postFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.resize();
  }

  setFov(fov: number): void {
    this.baseFov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setQuality(quality: 'high' | 'low'): void {
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1);
    this.resize();
  }

  resize(): void {
    const el = this.renderer.domElement;
    const w = Math.max(2, el.clientWidth);
    const h = Math.max(2, el.clientHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    const rw = Math.floor(w * this.pixelRatio);
    const rh = Math.floor(h * this.pixelRatio);
    this.rt.setSize(rw, rh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const u = this.post.uniforms;
    u.uRes!.value.set(rw, rh);
    u.uAspect!.value = w / h;
    u.uLineSpacing!.value = rh / 13.5;
  }

  render(): void {
    this.camera.updateMatrixWorld();
    shared.uLightDir.value.copy(LIGHT_WORLD).transformDirection(this.camera.matrixWorldInverse);
    const r = this.renderer;
    r.info.reset();
    r.setRenderTarget(this.rt);
    r.setClearColor(this.clearColor, 0);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    const u = this.post.uniforms;
    u.uNear!.value = this.camera.near;
    u.uFar!.value = this.camera.far;
    u.uInvProj!.value.copy(this.camera.projectionMatrixInverse);
    u.uInvView!.value.copy(this.camera.matrixWorld);
    u.uSkySat!.value = this.atmosphere.colour;
    u.uGloom!.value = this.atmosphere.gloom;
    u.uTime!.value = performance.now() / 1000;
    r.render(this.postScene, this.postCam);
  }

  dispose(): void {
    this.rt.dispose();
    disposeTree(this.postScene);
    this.renderer.dispose();
  }
}

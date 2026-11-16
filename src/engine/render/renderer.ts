// Painted renderer. The scene is drawn into a G-buffer (see ink-material.ts) plus depth, then a
// full-screen pass paints it like a hand-painted animation background: soft sunlight and cool
// sky-blue shadow, dappled brush texture (strong in grass and leaves, faint on plaster), soft
// contact shadows in corners, a painted sky with cumulus clouds and blue-white haze in the
// distance. There are no outlines. Saturation 0 is the same painting drained to grey;
// `atmosphere.gloom` (the ink tide) drains the whole view towards black and white and closes it
// in with ink. A final FXAA pass smooths polygon edges, which nothing else hides.
// Ported from doodle-game's render.js; the colour model and the look are new.
import * as THREE from 'three';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { type ColorDef, MAX_COLORS, PALETTE, color } from '@/content/palette';
import { type Daylight, daylightAt } from './daylight';
import { disposeTree } from '../resources';
import { NO_SHADOW_LAYER, shared } from './ink-material';

const postVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const postFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uAspect;
uniform vec3 uColors[${MAX_COLORS}];
uniform float uSolid[${MAX_COLORS}];
uniform float uTexture[${MAX_COLORS}];
uniform mat4 uInvProj;
uniform mat4 uInvView;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uShade;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uNight;
uniform int uGlass;
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
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.48; }
  return v;
}
float linDepth(float z) { float zn = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - zn * (uFar - uNear)); }
int indexOf(float code) { return int(floor(code + 0.0005)); }
vec3 paletteColor(float code) {
  int i = indexOf(code); vec3 c = uColors[0];
  for (int k = 0; k < ${MAX_COLORS}; k++) if (k == i) c = uColors[k];
  return c;
}
float solidOf(float code) {
  int i = indexOf(code); float s = 0.0;
  for (int k = 0; k < ${MAX_COLORS}; k++) if (k == i) s = uSolid[k];
  return s;
}
float textureOf(float code) {
  int i = indexOf(code); float s = 0.25;
  for (int k = 0; k < ${MAX_COLORS}; k++) if (k == i) s = uTexture[k];
  return s;
}
float satOf(float code) { return clamp(fract(code + 0.0005) / 0.9, 0.0, 1.0); }
vec3 greyOf(vec3 c) { return vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(0.97, 0.98, 1.0); }
/** A drained colour: a pale grey wash of it, lighter than its plain luminance. */
vec3 drainedOf(vec3 c) { return greyOf(c) * 0.72 + vec3(0.2); }

/** Sky colour near the horizon, which is also the colour of distant haze. */
vec3 horizonOf(vec3 rd) {
  // warmer towards the sun
  float toward = pow(max(0.0, dot(normalize(rd.xz + 1e-5), normalize(uSun.xz + 1e-5))), 3.0);
  return uHorizon + (uSunColor - vec3(0.9)) * 0.12 * toward * (1.0 - uNight);
}

/** Painted sky along a world-space ray: a deep turquoise overhead fading to a pale horizon,
 * with big cumulus clouds, white on the sunny side and blue-grey underneath. */
vec3 skyPaint(vec3 rd) {
  float e = rd.y;
  vec3 c = mix(horizonOf(rd), mix(uHorizon, uZenith, 0.55), smoothstep(-0.02, 0.2, e));
  c = mix(c, uZenith, smoothstep(0.2, 0.85, e));
  c += uSunColor * 0.11 * pow(max(0.0, dot(rd, uSun)), 8.0) * (1.0 - uNight);
  // stars, between the clouds, at night
  vec2 sp = rd.xz / (max(e, 0.0) + 0.3) * 160.0;
  float star = step(0.9975, hash21(floor(sp))) * smoothstep(0.02, 0.25, e) * uNight;
  vec2 cuv = rd.xz / (max(e, 0.0) + 0.16) * 0.75 + vec2(uTime * 0.006, uTime * 0.0025);
  // warp the noise into rounded heaps rather than streaks
  cuv += (vec2(fbm(cuv * 0.6), fbm(cuv * 0.6 + 3.1)) - 0.5) * 1.3;
  float n = fbm(cuv);
  float above = smoothstep(-0.01, 0.1, e);
  float thr = mix(0.6, 0.52, smoothstep(0.05, 0.55, e));
  float body = smoothstep(thr, thr + 0.03, n) * above;
  // lit where the cloud thins towards the sun, shadowed underneath
  float n2 = fbm(cuv + uSun.xz * 0.09);
  float lit = clamp((n - n2) * 8.0 + 0.55, 0.0, 1.0);
  lit = mix(lit, 1.0, smoothstep(0.05, 0.0, n - thr) * 0.5);
  vec3 cloudLit = mix(vec3(1.0, 0.99, 0.96), clamp(uSunColor, 0.0, 1.0), 0.35) * mix(1.0, 0.32, uNight);
  vec3 cloudShade = mix(uShade, uZenith, 0.3) * 1.15;
  vec3 cloud = mix(cloudShade, cloudLit, lit);
  c += vec3(star * 0.8);
  return mix(c, cloud, body);
}

void main() {
  vec2 px = 1.0 / uRes;
  vec4 s = texture2D(tScene, vUv);
  float z = texture2D(tDepth, vUv).x;
  float d = linDepth(z);
  bool sky = z >= 0.99999;
  vec2 pp = gl_FragCoord.xy;
  vec4 cp = uInvProj * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  vec3 vpos = cp.xyz / cp.w;
  vec3 rd = normalize(mat3(uInvView) * normalize(vpos));
  float skySat = uSkySat * (1.0 - uGloom);
  vec3 col;
  if (sky) {
    vec3 painted = skyPaint(rd);
    // drained: an overcast grey version of the same sky
    col = mix(drainedOf(painted), painted, skySat);
  } else {
    vec3 wpos = (uInvView * vec4(vpos, 1.0)).xyz;
    vec3 nView = vec3(s.ba, sqrt(max(0.0, 1.0 - dot(s.ba, s.ba))));
    vec3 wn = normalize(mat3(uInvView) * nView);
    float sat = satOf(s.g);
    float tex = textureOf(s.g);
    vec3 base = paletteColor(s.g);

    // brush texture, anchored to the world (held tools ride with the camera: keep them clean)
    vec3 an = abs(wn);
    vec2 bp = an.y > max(an.x, an.z) ? wpos.xz : (an.x > an.z ? wpos.zy : wpos.xy);
    float near = smoothstep(1.5, 3.0, d);
    float big = fbm(bp * 0.18);
    float leaf = fbm(bp * 1.3 + 7.0);
    float stroke = vnoise(vec2(bp.x * 2.5, bp.y * 0.6));
    float mott = ((big - 0.5) * 0.3 + (leaf - 0.5) * 0.35) * tex + (stroke - 0.5) * 0.06;
    base *= 1.0 + mott * near;
    // sunlit dapples in foliage turn yellow-green
    base = mix(base, base * vec3(1.18, 1.14, 0.78), tex * smoothstep(0.55, 0.75, leaf) * 0.55 * near);

    // light: sun with a soft, slightly broken terminator; shadow takes the sky's cool blue
    float ndl = s.r * 2.0 - 1.0;
    float lit = smoothstep(-0.12, 0.38, ndl + (leaf - 0.5) * 0.35 * tex);
    vec3 shadowTint = uShade * mix(0.9, 1.08, 0.5 + 0.5 * wn.y);
    // leaves and grass go deeper and bluer in shade
    shadowTint = mix(shadowTint, uShade * vec3(0.76, 0.88, 0.8), tex * 0.6);
    vec3 light = mix(shadowTint, uSunColor, lit);

    // soft contact shadow where surfaces meet (a few depth taps around the pixel)
    float rpx = clamp(14.0 / max(d, 0.5), 1.5, 26.0) * uRes.y / 900.0;
    float occ = 0.0;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.785 + hash21(pp) * 0.785;
      vec2 o = vec2(cos(a), sin(a)) * rpx * (0.5 + 0.5 * float(k / 4));
      float dk = linDepth(texture2D(tDepth, vUv + o * px).x);
      float diff = d - dk;
      occ += smoothstep(0.03, 0.4, diff) * (1.0 - smoothstep(0.8, 2.5, diff));
    }
    float ao = 1.0 - (occ / 8.0) * 0.45;

    vec3 painted = base * light * ao;
    // sunlit leaves catch bright yellow-green highlights
    painted += tex * lit * smoothstep(0.52, 0.75, leaf) * vec3(0.1, 0.11, 0.01) * near;
    col = mix(drainedOf(painted), painted, sat);
    // the ink: no paint, a wet sheen where the light catches it
    float solid = solidOf(s.g) * sat;
    vec3 wet = mix(paletteColor(s.g), vec3(0.36, 0.37, 0.44), pow(clamp(ndl, 0.0, 1.0), 6.0) * 0.55);
    col = mix(col, wet, solid * 0.97);
    // at night, lamps are lit behind some windows of the streets that have their colour back
    if (indexOf(s.g) == uGlass) {
      float on = step(0.4, hash21(floor(wpos.xz * 0.45) + floor(wpos.y / 3.2) * 7.3));
      col = mix(col, vec3(1.0, 0.76, 0.4), on * uNight * sat * 0.92);
    }

    // aerial perspective: far things melt into blue-white haze
    vec3 haze = horizonOf(rd);
    haze = mix(drainedOf(haze), haze, skySat);
    col = mix(col, haze, (1.0 - exp(-d * 0.0042)) * 0.85);
  }
  // a faint canvas grain so flat colour reads as paint
  col *= 0.985 + 0.03 * vnoise(pp * 0.7);
  if (uGloom > 0.001) {
    // the ink tide: colour drains out of everything and ink creeps in from the edges
    col = mix(col, greyOf(col), uGloom * 0.82);
    col *= 1.0 - 0.16 * uGloom;
    vec2 q = vUv - 0.5; q.x *= uAspect;
    float blot = (vnoise(pp * 0.006 + uTime * 0.07) - 0.5) * 0.22 + (vnoise(pp * 0.03) - 0.5) * 0.08;
    float vig = smoothstep(0.5, 0.9, length(q) + blot) * uGloom;
    col = mix(col, vec3(0.05, 0.05, 0.08), vig * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** Half the side of the square of ground that gets sun shadows, metres. */
const SHADOW_REACH = 70;
const SHADOW_SIZE = 2048;
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class InkRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.08, 480);
  private readonly rt: THREE.WebGLRenderTarget;
  /** The painted frame, before anti-aliasing. */
  private readonly paintRt: THREE.WebGLRenderTarget;
  private readonly post: THREE.ShaderMaterial;
  private readonly fxaa: THREE.ShaderMaterial;
  private readonly postScene = new THREE.Scene();
  private readonly fxaaScene = new THREE.Scene();
  private readonly postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clearColor = new THREE.Color(1, 0, 0);
  private pixelRatio: number;
  /** Sun shadows: a depth map from the sun's side, covering a square around the camera. */
  private readonly shadowRt: THREE.WebGLRenderTarget;
  private readonly shadowCam = new THREE.OrthographicCamera(
    -SHADOW_REACH,
    SHADOW_REACH,
    SHADOW_REACH,
    -SHADOW_REACH,
    1,
    500,
  );
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    side: THREE.DoubleSide,
  });
  /** The player's field of view; tools zoom relative to it and return to it. */
  baseFov = 78;
  /** Mood of the whole view, set by gameplay each frame. `colour` 0..1 is how much colour
   * is around the camera (the sky follows it); `gloom` 0..1 drains everything to black and
   * white with ink closing in from the edges. */
  readonly atmosphere = { colour: 1, gloom: 0, hour: 10 };
  /** Sun, sky and shade for the current hour; its vectors are the post pass's uniforms. */
  private readonly day: Daylight = daylightAt(10);

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
    const shadowDepth = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
    shadowDepth.format = THREE.DepthFormat;
    shadowDepth.type = THREE.FloatType;
    this.shadowRt = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: shadowDepth,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    shared.uShadowMap.value = shadowDepth;
    shared.uShadowTexel.value = 1 / SHADOW_SIZE;
    this.paintRt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    const colors = Array.from({ length: MAX_COLORS }, (_, i) => {
      const c = PALETTE[i]?.rgb ?? [1, 0, 1];
      return new THREE.Vector3(c[0], c[1], c[2]);
    });
    const perColor = (f: (c: ColorDef) => number, fallback: number): number[] =>
      Array.from({ length: MAX_COLORS }, (_, i) => {
        const c = PALETTE[i] as ColorDef | undefined;
        return c ? f(c) : fallback;
      });
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture },
        tDepth: { value: depthTexture },
        uRes: { value: new THREE.Vector2(2, 2) },
        uAspect: { value: 1 },
        uNear: { value: this.camera.near },
        uFar: { value: this.camera.far },
        uColors: { value: colors },
        uSolid: { value: perColor((c) => (c.solid ? 1 : 0), 0) },
        uTexture: { value: perColor((c) => c.texture ?? 0.25, 0.25) },
        uInvProj: { value: new THREE.Matrix4() },
        uInvView: { value: new THREE.Matrix4() },
        uSun: { value: this.day.dir },
        uSunColor: { value: this.day.sun },
        uShade: { value: this.day.shade },
        uZenith: { value: this.day.zenith },
        uHorizon: { value: this.day.horizon },
        uNight: { value: 0 },
        uGlass: { value: color('glass') },
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
    // the eye sees grass; the sun's shadow camera (default layer only) does not
    this.camera.layers.enable(NO_SHADOW_LAYER);
    this.fxaa = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: FXAAShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.fxaa.uniforms.tDiffuse!.value = this.paintRt.texture;
    this.fxaaScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fxaa));
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
    this.paintRt.setSize(rw, rh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const u = this.post.uniforms;
    u.uRes!.value.set(rw, rh);
    u.uAspect!.value = w / h;
    this.fxaa.uniforms.resolution!.value.set(1 / rw, 1 / rh);
  }

  render(): void {
    this.camera.updateMatrixWorld();
    daylightAt(this.atmosphere.hour, this.day);
    shared.uLightDir.value.copy(this.day.dir).transformDirection(this.camera.matrixWorldInverse);
    const r = this.renderer;
    r.info.reset();
    this.renderShadows();
    r.setRenderTarget(this.rt);
    r.setClearColor(this.clearColor, 0);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    const u = this.post.uniforms;
    u.uNear!.value = this.camera.near;
    u.uFar!.value = this.camera.far;
    u.uInvProj!.value.copy(this.camera.projectionMatrixInverse);
    u.uInvView!.value.copy(this.camera.matrixWorld);
    u.uSkySat!.value = this.atmosphere.colour;
    u.uGloom!.value = this.atmosphere.gloom;
    u.uNight!.value = this.day.night;
    u.uTime!.value = performance.now() / 1000;
    shared.uTime.value = u.uTime!.value;
    r.setRenderTarget(this.paintRt);
    r.render(this.postScene, this.postCam);
    r.setRenderTarget(null);
    r.render(this.fxaaScene, this.postCam);
  }

  /**
   * Draw the scene's depth as the sun sees it, over a square centred a little ahead of the
   * camera. The square moves in whole texels so shadow edges do not crawl as the player walks.
   */
  private renderShadows(): void {
    const dir = this.day.dir;
    const cam = this.camera;
    cam.getWorldDirection(_fwd).setY(0);
    if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
    _centre.setFromMatrixPosition(cam.matrixWorld).addScaledVector(_fwd, SHADOW_REACH * 0.45);
    // light-space axes, then snap the centre to the texel grid along them
    _right.set(0, 1, 0).cross(dir).normalize();
    _up.crossVectors(dir, _right).normalize();
    const texel = (SHADOW_REACH * 2) / SHADOW_SIZE;
    const r = Math.round(_centre.dot(_right) / texel) * texel - _centre.dot(_right);
    const u = Math.round(_centre.dot(_up) / texel) * texel - _centre.dot(_up);
    _centre.addScaledVector(_right, r).addScaledVector(_up, u);
    const sc = this.shadowCam;
    sc.position.copy(_centre).addScaledVector(dir, 250);
    sc.up.copy(_up);
    sc.lookAt(_centre);
    sc.updateMatrixWorld();
    shared.uShadowMatrix.value.multiplyMatrices(BIAS, sc.projectionMatrix).multiply(sc.matrixWorldInverse);
    shared.uShadowOn.value = 1;
    const gl = this.renderer;
    // the held tool hangs off the camera; it should not throw a shadow
    const camVisible = cam.visible;
    cam.visible = false;
    this.scene.overrideMaterial = this.shadowMaterial;
    gl.setRenderTarget(this.shadowRt);
    gl.clear(false, true, false);
    gl.render(this.scene, sc);
    this.scene.overrideMaterial = null;
    cam.visible = camVisible;
  }

  dispose(): void {
    this.rt.dispose();
    this.shadowRt.dispose();
    this.shadowMaterial.dispose();
    this.paintRt.dispose();
    disposeTree(this.postScene);
    disposeTree(this.fxaaScene);
    this.renderer.dispose();
  }
}

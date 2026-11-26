// Painted renderer. The scene is drawn into a G-buffer (see ink-material.ts) plus depth, then a
// full-screen pass paints it like a hand-painted animation background: sunlight and blue-violet
// shade with a firm, brushed edge between them, hand-painted brushwork on every surface (tiles,
// plaster, paving, timber and stone from painted textures, see painted-textures.ts; strong in
// grass and leaves, faint on plaster), soft contact shadows in corners, a painted sky with
// towering cumulus and blue-white haze in the distance. The background has no outlines; people are
// cels with a thin warm line. Saturation 0 is the same picture as a pen drawing on paper (sepia
// hatching and outlines, an unpainted comic page);
// `atmosphere.gloom` (the ink tide) drains the whole view towards black and white and closes it
// in with ink. A final FXAA pass smooths polygon edges, which nothing else hides.
// Ported from doodle-game's render.js; the colour model and the look are new.
// The passes live beside it: paint-shader.ts / paint-pass.ts (the paint pass, with its sky and
// water chunks in sky-paint.ts and water-paint.ts), brush-pass.ts, glow.ts and sun-shadows.ts.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { type Daylight, daylightAt } from './daylight';
import { ResolutionGovernor } from './resolution';
import { Critters } from './critters';
import { STEAM_SPRINGS, Steam } from './steam';
import { Birds } from './birds';
import { Precipitation } from './precipitation';
import { makeCanopyBrush } from './canopy-brush';
import { disposeTree } from '../resources';
import { NO_SHADOW_LAYER, shared } from './ink-material';
import { makeBrushMaterial } from './brush-pass';
import { GlowPass } from './glow';
import { Lamps } from './lamps';
import { makeNoise, makePaintMaterial } from './paint-pass';
import { PaintedTextures } from './painted-textures';
import { SEA_SLOTS } from './paint-shader';
import { PassTimer } from './pass-timer';
import { SunShadows } from './sun-shadows';
import { CURRENT_STEP } from '@/world/wilderness/water-current';
import { RIVER_SAMPLES, RiverTable } from './water-paint';
import { WakeField } from './wake-field';
import { WaterSpray } from './water-spray';

/** Most pixels drawn a frame at each quality, to start with: about 2300 x 1400, and 1900 x 1100.
 * When frames keep up, automatic resolution raises it along with the pixel ratio. */
const PIXEL_BUDGET = { high: 3.2e6, low: 2.1e6 } as const;
/** Pixel ratio each quality starts at, and the most it goes up to while frames keep up (a
 * retina screen's own 2 on high: sharper brushwork where the GPU has room for it). */
const PIXEL_RATIO = { high: { start: 1.5, most: 2 }, low: { start: 1, most: 1 } } as const;
const _grey = new THREE.Vector3();
const _avg = new THREE.Vector3();
const _eye = new THREE.Vector3();
/** What a lightning flash adds to the light: a cold white-violet. */
const _flash = new THREE.Vector3(0.7, 0.72, 0.9);

export class InkRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.08, TUNING.world.landscape.far);
  private readonly rt: THREE.WebGLRenderTarget;
  /** The painted frame, before anti-aliasing. */
  private readonly paintRt: THREE.WebGLRenderTarget;
  private readonly post: THREE.ShaderMaterial;
  private readonly fxaa: THREE.ShaderMaterial;
  private readonly postScene = new THREE.Scene();
  private readonly fxaaScene = new THREE.Scene();
  /** Soft glow: bright parts at a quarter of the resolution, blurred both ways, added on top. */
  private readonly glow = new GlowPass();
  /** The frame after the brush pass, before FXAA. */
  private readonly brushRt: THREE.WebGLRenderTarget;
  private readonly brush: THREE.ShaderMaterial;
  private readonly brushScene = new THREE.Scene();
  /** Pixels between brush-filter taps at 900 px tall (scaled with the frame); quality sets it. */
  private brushSpread = 2.1;
  private readonly postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clearColor = new THREE.Color(1, 0, 0);
  private pixelRatio: number;
  /** The quality setting's pixel ratio: the most the frame is ever drawn at. */
  private maxPixelRatio: number;
  /** The governor's scale the quality setting starts at (its start ratio over its most). */
  private startScale = 1;
  /** Most pixels drawn a frame (see resize). */
  private pixelBudget: number = PIXEL_BUDGET.high;
  /** Automatic resolution: how much of maxPixelRatio is drawn now. */
  private readonly governor = new ResolutionGovernor();
  /** Sun shadows: a depth map from the sun's side, covering a square around the camera. */
  private readonly shadows = new SunShadows();
  private readonly canopyBrush = makeCanopyBrush();
  private readonly noise = makeNoise();
  /** Hand-painted surface tiles and clouds for the paint pass. */
  private readonly painted: PaintedTextures;
  readonly texturesReady: Promise<void>;
  /** Surface velocities around the player for the water shader. */
  private readonly rivers = new RiverTable();
  private readonly wakes = new WakeField();
  private riverVelocity: ((x: number, z: number) => { x: number; z: number }) | null = null;
  private readonly spray: WaterSpray;
  /** The player's field of view; tools zoom relative to it and return to it. */
  baseFov = 78;
  /** Mood of the whole view, set by gameplay each frame. `colour` 0..1 is how much colour
   * is around the camera (the sky follows it); `gloom` 0..1 drains everything to black and
   * white with ink closing in from the edges. `hour` and `declination` (the time of year, see
   * `calendarAt`) place the sun; `year` (0..1) turns the plants and `seaTemp` (the day's mean
   * temperature at ground level, °C) sets where snow lies. */
  readonly atmosphere = {
    colour: 1,
    gloom: 0,
    hour: 10,
    declination: 0,
    year: 0.375,
    seaTemp: 25,
    /** The weather where the player is, eased (see AtmosphereSystem): cloud cover, rain and
     * snow falling, mist, wet ground and fresh snow (0..1), wind (m/s) and a lightning flash. */
    weather: {
      cloud: 0,
      rain: 0,
      snowfall: 0,
      fog: 0,
      wet: 0,
      freshSnow: 0,
      windX: 0,
      windZ: 0,
      flash: 0,
      /** Petals or leaves blowing about, and which season's colours they are. */
      litter: 0,
      litterSeason: 0,
      /** A rainbow could show (shown only while the sun is up and low enough), hoar frost. */
      rainbow: 0,
      frost: 0,
    },
  };
  /** Wind travel in metres for cloud drift and the meadow wind map. */
  private readonly drift = new THREE.Vector2();
  private lastFrame = performance.now();
  /** How strongly broken cloud shades the ground, 0..1 (from `applyWeather`). */
  private cloudShade = 0;
  /** Rain, snow and lightning over the painted frame. */
  private readonly precipitation: Precipitation;
  /** Fireflies and butterflies in the air round the player (moved by the atmosphere system). */
  readonly critters: Critters;
  /** Steam off nearby hot springs (set by the atmosphere system). */
  readonly steam: Steam;
  /** Lit windows and chimneys of the houses now loaded (scenes add their meshes): the
   * nearest windows light the street at night, the nearest chimneys smoke. */
  readonly lamps = new Lamps();
  private readonly smoke: Steam;
  private lampFrame = 0;
  /** Flocks of birds wheeling high over the land (moved by the atmosphere system). */
  readonly birds: Birds;
  /** The nearest hot spring (x, z, radius; radius 0 for none): no snow lies round it. */
  readonly warmSpot = new THREE.Vector4();
  /** Flower seas near by, nearest first (set by the atmosphere system): x, z, radius (0 for
   * none), palette index + bloom × 0.9; and the phases of their edges' lobes. */
  readonly flowerSeas = Array.from({ length: SEA_SLOTS }, () => new THREE.Vector4());
  readonly flowerSeaLobes = Array.from({ length: SEA_SLOTS }, () => new THREE.Vector4());
  /** Sun, sky and shade for the current hour; its vectors are the post pass's uniforms. */
  private readonly day: Daylight = daylightAt(10);
  /** GPU time per pass while profiling (see passTimes). */
  private readonly timer = new PassTimer();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      // Depth runs from 1 at the eye to 0 far off, into a float buffer: precision then holds
      // all the way out, so a window frame a centimetre off its wall does not flicker on a
      // town a few hundred metres away. Where the browser cannot, depth runs the usual way.
      reverseDepthBuffer: true,
    });
    shared.uReversedDepth.value = this.renderer.capabilities.reverseDepthBuffer ? 1 : 0;
    if (shared.uReversedDepth.value) {
      // three (r170) turns depth round with the clip range and the clear value still set for
      // the usual way: depth would land in 0.5..1 (no precision gained) and clear to the near
      // end. Put both right: clip depth to 0..1, and clear to the far end through three's own
      // state (a different value first, or it thinks nothing changed).
      const ext = this.renderer.extensions.get('EXT_clip_control');
      ext.clipControlEXT(ext.LOWER_LEFT_EXT, ext.ZERO_TO_ONE_EXT);
      const depth = this.renderer.state.buffers.depth;
      depth.setClear(0.5);
      depth.setClear(1);
    }
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
    this.maxPixelRatio = 1;
    this.pixelRatio = 1;
    this.pickResolution('high');
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
    shared.uCanopyBrush.value = this.canopyBrush;
    this.painted = new PaintedTextures(
      Math.min(4, this.renderer.capabilities.getMaxAnisotropy()),
      this.canopyBrush,
    );
    shared.uPlants.value = this.painted.plants;
    this.texturesReady = this.painted.load();
    this.paintRt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.post = makePaintMaterial({
      scene: this.rt.texture,
      depth: depthTexture,
      noise: this.noise,
      rivers: this.rivers.texture,
      wakes: this.wakes.texture,
      wakeBounds: this.wakes.bounds,
      canopyBrush: this.canopyBrush,
      surfaces: this.painted.surfaces,
      clouds: this.painted.clouds,
      interiors: this.painted.interiors,
      camera: this.camera,
      day: this.day,
      drift: this.drift,
      year: this.atmosphere.year,
      seaTemp: this.atmosphere.seaTemp,
      seas: this.flowerSeas,
      seaLobes: this.flowerSeaLobes,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.precipitation = new Precipitation(depthTexture);
    this.critters = new Critters(depthTexture);
    this.steam = new Steam(depthTexture);
    this.spray = new WaterSpray(depthTexture);
    this.smoke = new Steam(depthTexture);
    this.birds = new Birds(depthTexture);
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
    this.brushRt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.brush = makeBrushMaterial(this.paintRt.texture);
    this.brushScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brush));
    // FXAA smooths the brushed frame, not the raw one
    this.fxaa.uniforms.tDiffuse!.value = this.brushRt.texture;
    this.resize();
  }

  setFov(fov: number): void {
    this.baseFov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setQuality(quality: 'high' | 'low'): void {
    this.pickResolution(quality);
    // smaller patches on the faster setting (the filter cost does not change, the look does)
    this.brushSpread = quality === 'high' ? 2.1 : 1.6;
    // and a lighter paint pass: half the contact shadow's taps, no dabs on the ground
    const cheap = quality === 'low';
    if ('CHEAP' in this.post.defines !== cheap) {
      if (cheap) this.post.defines.CHEAP = '';
      else delete this.post.defines.CHEAP;
      this.post.needsUpdate = true;
    }
    this.resize();
  }

  /** A quality setting's resolution: start at its start ratio (or the screen's own, if less)
   * and let the governor find its level, up to the most the setting and the screen allow. */
  private pickResolution(quality: 'high' | 'low'): void {
    const dpr = window.devicePixelRatio || 1;
    const r = PIXEL_RATIO[quality];
    this.maxPixelRatio = Math.min(dpr, r.most);
    this.startScale = Math.min(1, Math.min(dpr, r.start) / this.maxPixelRatio);
    this.pixelBudget = PIXEL_BUDGET[quality];
    this.governor.reset(this.startScale);
    this.pixelRatio = this.maxPixelRatio * this.governor.scale;
  }

  resize(): void {
    const el = this.renderer.domElement;
    const w = Math.max(2, el.clientWidth);
    const h = Math.max(2, el.clientHeight);
    // a big window draws no more pixels than the budget (never under one per CSS pixel): every
    // pass after the scene runs once a pixel, and the brush filter softens the detail anyway
    // (the budget grows as the governor steps up from where it started, so it starts where it
    // always did and only a GPU that keeps up draws more)
    const budget = this.pixelBudget * (this.governor.scale / this.startScale) ** 2;
    const ratio = Math.min(this.pixelRatio, Math.max(1, Math.sqrt(budget / (w * h))));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    const rw = Math.floor(w * ratio);
    const rh = Math.floor(h * ratio);
    this.rt.setSize(rw, rh);
    this.paintRt.setSize(rw, rh);
    this.brushRt.setSize(rw, rh);
    const bu = this.brush.uniforms;
    bu.uTexel!.value.set(1 / rw, 1 / rh);
    bu.uSpread!.value = this.brushSpread * Math.max(1, rh / 900);
    bu.uAspect!.value = w / h;
    this.glow.setSize(rw, rh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const u = this.post.uniforms;
    u.uRes!.value.set(rw, rh);
    u.uAspect!.value = w / h;
    this.fxaa.uniforms.resolution!.value.set(1 / rw, 1 / rh);
    this.precipitation.setSize(rw, rh);
    this.critters.setSize(rw, rh);
    this.steam.setSize(rw, rh);
    this.spray.setSize(rw, rh);
    this.smoke.setSize(rw, rh);
    this.birds.setSize(rw, rh);
  }

  /** Lightning strikes the ground at `at` (drawn for a moment; `shape` picks its path). */
  strike(at: THREE.Vector3Like, shape: number): void {
    this.precipitation.strike(at, shape);
  }

  /**
   * The weather over the day's light: cloud veils the sun and greys the sky, so sunlight and
   * shade draw together; a lightning flash lights everything for a moment.
   */
  private applyWeather(): void {
    const w = this.atmosphere.weather;
    const d = this.day;
    const falling = Math.min(1, w.rain + w.snowfall);
    const grey = (v: THREE.Vector3, amount: number, dim: number): void => {
      const l = v.x * 0.3 + v.y * 0.59 + v.z * 0.11;
      v.lerp(_grey.set(l, l, l * 1.04), amount).multiplyScalar(dim);
    };
    d.sun.multiplyScalar(1 - 0.5 * w.cloud - 0.15 * falling);
    // under an unbroken deck light comes from the whole sky: sun and shade meet, shadows go
    const flat = THREE.MathUtils.smoothstep(w.cloud, 0.55, 1) * 0.85;
    _avg.copy(d.sun).add(d.shade).multiplyScalar(0.5);
    d.sun.lerp(_avg, flat);
    d.shade.lerp(_avg, flat);
    // broken cloud instead throws moving shadows on the ground (post pass)
    this.cloudShade =
      THREE.MathUtils.smoothstep(w.cloud, 0.05, 0.3) * (1 - flat / 0.85) * (1 - this.day.night);
    grey(d.sun, 0.4 * w.cloud, 1);
    grey(d.shade, 0.3 * w.cloud, 1);
    grey(d.zenith, 0.55 * w.cloud + 0.2 * falling, 1 - 0.25 * falling);
    grey(d.horizon, 0.45 * w.cloud + 0.2 * falling, 1 - 0.15 * falling);
    if (w.flash > 0)
      for (const v of [d.sun, d.shade, d.zenith, d.horizon]) v.addScaledVector(_flash, w.flash);
  }

  /** How much of the quality setting's resolution is drawn now (automatic resolution). */
  get resolutionScale(): number {
    return this.governor.scale;
  }

  setRivers(x0: number, z0: number, at: (x: number, z: number) => { x: number; z: number }): void {
    this.riverVelocity = at;
    this.rivers.set(x0, z0, at);
    this.post.uniforms.uRiverGrid!.value.set(x0, z0, CURRENT_STEP, RIVER_SAMPLES);
  }

  setWildWater(enabled: boolean): void {
    this.post.uniforms.uWildWater!.value = enabled;
  }

  ripple(x: number, z: number, fromPlayer: boolean, strength = fromPlayer ? 1 : 0.52): void {
    const v = this.riverVelocity?.(x, z);
    this.wakes.add(x, z, performance.now() / 1000, fromPlayer, strength, v?.x, v?.z);
  }

  waterSplash(x: number, z: number, strength: number, flowX: number, flowZ: number): void {
    this.spray.add(x, z, performance.now() / 1000, strength, flowX, flowZ);
  }

  /** While profiling (dev tools): GPU milliseconds per pass, summed over the frames measured
   * (`gpuFrames`). Timed with the GPU's own timer queries, which answer a frame or two late. */
  get passTimes(): Map<string, number> | null {
    return this.timer.times;
  }
  set passTimes(times: Map<string, number> | null) {
    this.timer.times = times;
  }
  get gpuFrames(): number {
    return this.timer.frames;
  }
  set gpuFrames(frames: number) {
    this.timer.frames = frames;
  }

  /** End the pass being timed, if any, and start timing `next` (null: the frame is done). */
  private pass(next: string | null): void {
    this.timer.pass(this.renderer, next);
  }

  /** Dev tools: milliseconds per pass, each drawn `n` times and waited for every time (a pixel
   * read makes the GPU finish), less the cost of the wait itself. Steadier than timer queries
   * when the page is in the background. */
  benchPasses(n = 20): Record<string, number> {
    const r = this.renderer;
    const px = new Uint8Array(4);
    // reading the screen waits for everything drawn to it, and so for every pass before it
    const gl = r.getContext();
    const wait = (): void => {
      r.setRenderTarget(null);
      r.render(this.fxaaScene, this.postCam);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    const out: Record<string, number> = {};
    // each draw is waited for on its own: drawn back to back, a tile-based GPU (Apple's) skips
    // shading what the next full-screen draw covers, and only the last one would cost anything
    const time = (name: string, draw: () => void): void => {
      wait();
      const t = performance.now();
      for (let i = 0; i < n; i++) {
        draw();
        wait();
      }
      out[name] = (performance.now() - t) / n;
    };
    this.render();
    time('(wait)', () => {});
    time('frame', () => this.render());
    time('scene', () => {
      r.setRenderTarget(this.rt);
      r.clear(true, true, false);
      r.render(this.scene, this.camera);
    });
    time('shadows', () => this.shadows.draw(r, this.scene, this.camera));
    time('paint', () => {
      r.setRenderTarget(this.paintRt);
      r.render(this.postScene, this.postCam);
    });
    time('brush', () => {
      r.setRenderTarget(this.brushRt);
      r.render(this.brushScene, this.postCam);
    });
    time('fxaa', () => {
      r.setRenderTarget(null);
      r.render(this.fxaaScene, this.postCam);
    });
    time('glow', () => this.renderGlow());
    const base = out['(wait)']!;
    for (const k of Object.keys(out)) if (k !== '(wait)') out[k] = Math.round((out[k]! - base) * 100) / 100;
    return out;
  }

  render(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const w = this.atmosphere.weather;
    shared.uWind.value.set(w.windX, w.windZ);
    this.drift.addScaledVector(shared.uWind.value, dt);
    shared.uWindDrift.value.copy(this.drift);
    shared.uTime.value = now / 1000;
    if (this.governor.frame(now)) {
      this.pixelRatio = this.maxPixelRatio * this.governor.scale;
      this.resize();
    }
    this.camera.updateMatrixWorld();
    daylightAt(this.atmosphere.hour, this.atmosphere.declination, this.day);
    this.applyWeather();
    shared.uLightDir.value.copy(this.day.dir).transformDirection(this.camera.matrixWorldInverse);
    const r = this.renderer;
    r.info.reset();
    this.pass('wake');
    this.post.uniforms.uHasWakes!.value = this.post.uniforms.uWildWater!.value &&
      this.wakes.render(r, this.camera.getWorldPosition(_eye), now / 1000);
    this.pass('shadows');
    this.shadows.update(r, this.scene, this.camera, this.day.dir);
    this.pass('scene');
    r.setRenderTarget(this.rt);
    r.setClearColor(this.clearColor, 0);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    this.pass('paint');
    const u = this.post.uniforms;
    u.uNear!.value = this.camera.near;
    u.uFar!.value = this.camera.far;
    u.uInvProj!.value.copy(this.camera.projectionMatrixInverse);
    u.uInvView!.value.copy(this.camera.matrixWorld);
    u.uViewProj!.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    u.uSkySat!.value = this.atmosphere.colour;
    u.uGloom!.value = this.atmosphere.gloom;
    u.uYear!.value = this.atmosphere.year;
    u.uSeaTemp!.value = this.atmosphere.seaTemp;
    u.uCloud!.value = w.cloud;
    u.uOvercast!.value = Math.min(1, w.rain + w.snowfall);
    u.uFog!.value = w.fog;
    u.uWet!.value = w.wet;
    u.uFreshSnow!.value = w.freshSnow;
    u.uCloudShade!.value = this.cloudShade;
    // the bow stands 42° from the point opposite the sun: none once the sun is higher than that
    const sunUp = this.day.dir.y;
    u.uRainbow!.value =
      w.rainbow *
      THREE.MathUtils.smoothstep(sunUp, 0, 0.06) *
      (1 - THREE.MathUtils.smoothstep(sunUp, 0.5, 0.7)) *
      (1 - this.day.night);
    u.uFrost!.value = w.frost;
    u.uRainfall!.value = w.rain;
    (u.uWarm!.value as THREE.Vector4).copy(this.warmSpot);
    u.uNight!.value = this.day.night;
    u.uTime!.value = shared.uTime.value;
    // which windows and chimneys are nearest changes slowly: look every few frames
    if (this.lampFrame++ % 6 === 0) {
      const eye = this.camera.getWorldPosition(_eye);
      this.lamps.lampsNear(eye, u.uLamps!.value as THREE.Vector4[]);
      // hearths are lit where the town has its colour back; more smoke in the cold and at dusk
      const chimneys = this.lamps.chimneysNear(eye, STEAM_SPRINGS, 90).map((c) => ({ ...c, r: 0.3 }));
      const cold = THREE.MathUtils.smoothstep(this.atmosphere.seaTemp, 22, 4);
      this.smoke.set(
        chimneys,
        this.atmosphere.colour * (0.45 + 0.35 * cold + 0.2 * this.day.night),
        w.windX,
        w.windZ,
      );
    }
    r.setRenderTarget(this.paintRt);
    r.render(this.postScene, this.postCam);
    this.pass('brush');
    this.brush.uniforms.uTime!.value = u.uTime!.value;
    r.setRenderTarget(this.brushRt);
    r.render(this.brushScene, this.postCam);
    this.pass('weather');
    // after the brush pass, which would smear one-pixel streaks away
    this.precipitation.render(r, this.camera, { ...w, night: this.day.night }, u.uTime!.value);
    this.critters.render(r, this.camera, this.day.night);
    this.steam.render(r, this.camera, u.uTime!.value, this.day.night);
    if (u.uWildWater!.value) this.spray.render(r, this.camera, now / 1000, this.day.night, this.day.dir);
    this.smoke.render(r, this.camera, u.uTime!.value, this.day.night);
    this.birds.render(r, this.camera, this.day.night);
    this.pass('fxaa');
    r.setRenderTarget(null);
    r.render(this.fxaaScene, this.postCam);
    this.pass('glow');
    this.renderGlow();
    this.pass(null);
  }

  /** Pick the bright parts, blur them across then down at quarter size, add them to the screen. */
  private renderGlow(): void {
    this.glow.render(this.renderer, this.paintRt.texture, this.postCam);
  }

  dispose(): void {
    this.canopyBrush.dispose();
    this.noise.dispose();
    this.painted.dispose();
    this.rivers.dispose();
    this.wakes.dispose();
    if (shared.uCanopyBrush.value === this.canopyBrush) shared.uCanopyBrush.value = null;
    if (shared.uPlants.value === this.painted.plants) shared.uPlants.value = null;
    this.precipitation.dispose();
    this.critters.dispose();
    this.steam.dispose();
    this.spray.dispose();
    this.smoke.dispose();
    this.birds.dispose();
    this.rt.dispose();
    this.shadows.dispose();
    this.paintRt.dispose();
    this.brushRt.dispose();
    this.brush.dispose();
    disposeTree(this.brushScene);
    this.glow.dispose();
    disposeTree(this.postScene);
    disposeTree(this.fxaaScene);
    this.renderer.dispose();
  }
}

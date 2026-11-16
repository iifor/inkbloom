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
import { SEASONS } from '@/content/seasons';
import { TUNING } from '@/content/tuning';
import { type Daylight, daylightAt } from './daylight';
import { Precipitation } from './precipitation';
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
uniform int uWater;
uniform int uGrass;
uniform int uRock;
uniform int uSnow;
uniform float uSeasonKind[${MAX_COLORS}];
uniform vec4 uMeadow[4];
uniform vec4 uLeaf[4];
uniform vec4 uLeafAlt[4];
uniform float uYear;
uniform float uStagger;
uniform float uSeaTemp;
uniform float uLapse;
uniform float uCloud;
uniform float uOvercast;
uniform float uFog;
uniform float uWet;
uniform float uFreshSnow;
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
/** 0 unchanged by the seasons, 1 meadow (ground, grass), 2 broadleaf crowns. */
float seasonKindOf(float code) {
  int i = indexOf(code); float s = 0.0;
  for (int k = 0; k < ${MAX_COLORS}; k++) if (k == i) s = uSeasonKind[k];
  return s;
}
/** target, taking most of c's lightness, so dark woods stay darker than sunny meadows. */
vec3 atLightness(vec3 target, vec3 c) {
  float l = dot(c, vec3(0.3, 0.59, 0.11)) / max(dot(target, vec3(0.3, 0.59, 0.11)), 0.01);
  return target * mix(1.0, l, 0.7);
}
/** A plant colour at this time of year (content/seasons.ts). Each place runs a little ahead of
 * or behind the calendar, so woods turn patch by patch; some take the season's other colour. */
vec3 seasonal(vec3 c, float kind, vec2 xz) {
  if (kind < 0.5) return c;
  float p = fract(uYear - 0.125 + (vnoise(xz * 0.03) - 0.5) * 2.0 * uStagger) * 4.0;
  int a = int(floor(p));
  int b = a == 3 ? 0 : a + 1;
  float t = smoothstep(0.0, 1.0, fract(p));
  float pick = vnoise(xz * 0.17 + 31.0);
  vec3 ca = c, cb = c;
  for (int k = 0; k < 4; k++) {
    vec4 key = kind < 1.5 ? uMeadow[k] : uLeaf[k];
    vec3 rgb = key.rgb;
    if (kind > 1.5) rgb = mix(rgb, uLeafAlt[k].rgb, step(1.0 - uLeafAlt[k].a, pick));
    vec3 look = mix(c, atLightness(rgb, c), key.a);
    if (k == a) ca = look;
    if (k == b) cb = look;
  }
  return mix(ca, cb, t);
}
vec2 hash22(vec2 p) { return vec2(hash21(p), hash21(p + 17.31)); }
/**
 * Brush dabs: a cellular pattern where each cell is one stroke of paint with its own random
 * value (-0.5..0.5). Neighbouring strokes blend softly where they meet, like wet paint.
 */
float dabs(vec2 p) {
  vec2 ci = floor(p);
  vec2 cf = fract(p);
  float best = 9.0, second = 9.0, id = 0.0, id2 = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 r = o + hash22(ci + o) * 0.85 - cf;
      float dd = dot(r, r);
      float v = hash21(ci + o + 3.7);
      if (dd < best) { second = best; id2 = id; best = dd; id = v; }
      else if (dd < second) { second = dd; id2 = v; }
    }
  float blend = 0.5 * (1.0 - smoothstep(0.0, 0.3, sqrt(second) - sqrt(best)));
  return mix(id, id2, blend) - 0.5;
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
  // a flatter projection than a true cloud deck, so clouds near the horizon heap up instead of
  // stretching into streaks
  vec2 cuv = rd.xz / (max(e, 0.0) + 0.3) * 1.0 + vec2(uTime * 0.006, uTime * 0.0025);
  // warp the noise into rounded heaps rather than streaks
  cuv += (vec2(fbm(cuv * 0.6), fbm(cuv * 0.6 + 3.1)) - 0.5) * 1.3;
  float n = fbm(cuv);
  float above = smoothstep(-0.01, 0.1, e);
  // the weather's cloud cover fills the gaps until the sky is one grey deck
  float thr = mix(0.6, 0.52, smoothstep(0.05, 0.55, e)) - uCloud * 0.34;
  float body = smoothstep(thr, thr + 0.03 + uCloud * 0.05, n) * above;
  // lit where the cloud thins towards the sun, shadowed underneath
  float n2 = fbm(cuv + uSun.xz * 0.09);
  float lit = clamp((n - n2) * 8.0 + 0.55, 0.0, 1.0);
  lit = mix(lit, 1.0, smoothstep(0.05, 0.0, n - thr) * 0.5);
  vec3 cloudLit = mix(vec3(1.0, 0.99, 0.96), clamp(uSunColor, 0.0, 1.0), 0.35) * mix(1.0, 0.32, uNight);
  vec3 cloudShade = mix(uShade, uZenith, 0.3) * 1.15;
  // rain clouds are heavy and grey, darker underneath
  vec3 rainGrey = vec3(0.6, 0.62, 0.67) * mix(1.0, 0.3, uNight);
  cloudLit = mix(cloudLit, rainGrey, uOvercast * 0.75 + uCloud * 0.15);
  cloudShade = mix(cloudShade, rainGrey * 0.72, uOvercast * 0.8);
  vec3 cloud = mix(cloudShade, cloudLit, lit);
  c += vec3(star * 0.8);
  return mix(c, cloud, body);
}

/**
 * Far mountain ranges painted along the horizon behind everything: two layers of ridges, the
 * far one pale and hazy, the near one bluer and darker. Sampled around a circle so there is no
 * seam. Returns the colour and, in w, how much of it covers the sky here.
 */
vec4 farRanges(vec3 rd) {
  vec2 dir = normalize(rd.xz + 1e-5);
  float e = rd.y;
  vec3 haze = horizonOf(rd);
  vec3 far = mix(haze, mix(uZenith, uShade, 0.4), 0.32);
  vec3 near = mix(haze, mix(uShade * vec3(0.8, 0.95, 0.9), uZenith, 0.35), 0.55);
  float h1 = 0.035 + 0.075 * fbm(dir * 3.0 + 11.0);
  float h2 = 0.012 + 0.05 * fbm(dir * 5.5 + 29.0);
  float m1 = smoothstep(h1 + 0.002, h1 - 0.002, e);
  float m2 = smoothstep(h2 + 0.002, h2 - 0.002, e);
  // lighter towards their feet, where the haze is thickest
  far = mix(haze, far, smoothstep(-0.02, h1, e) * 0.85 + 0.15);
  near = mix(haze, near, smoothstep(-0.02, h2, e) * 0.8 + 0.2);
  vec3 c = mix(far, near, m2);
  return vec4(c, max(m1, m2));
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
    vec4 ranges = farRanges(rd);
    painted = mix(painted, ranges.rgb, ranges.w * (1.0 - uNight * 0.5));
    // drained: an overcast grey version of the same sky
    col = mix(drainedOf(painted), painted, skySat);
  } else {
    vec3 wpos = (uInvView * vec4(vpos, 1.0)).xyz;
    vec3 nView = vec3(s.ba, sqrt(max(0.0, 1.0 - dot(s.ba, s.ba))));
    vec3 wn = normalize(mat3(uInvView) * nView);
    float sat = satOf(s.g);
    float tex = textureOf(s.g);
    vec3 base = seasonal(paletteColor(s.g), seasonKindOf(s.g), wpos.xz);

    // brush texture, anchored to the world (held tools ride with the camera: keep them clean)
    vec3 an = abs(wn);
    vec2 bp = an.y > max(an.x, an.z) ? wpos.xz : (an.x > an.z ? wpos.zy : wpos.xy);
    float near = smoothstep(1.5, 3.0, d);
    float big = fbm(bp * 0.18);
    float leaf = fbm(bp * 1.3 + 7.0);
    float stroke = vnoise(vec2(bp.x * 2.5, bp.y * 0.6));
    // where meadow ground gets steep, bare rock shows through, with a ragged painted edge
    if (indexOf(s.g) == uGrass) {
      float steep = 1.0 - smoothstep(0.62, 0.74, wn.y + (big - 0.5) * 0.18 + (leaf - 0.5) * 0.08);
      base = mix(base, paletteColor(float(uRock)), steep);
      tex = mix(tex, 0.7, steep);
      // the meadow floor is mostly seen between the grass, down in its shade
      base *= mix(0.78, 1.0, steep);
    }
    // snow lies on what faces up wherever the day's mean temperature is below freezing (colder
    // higher up), in patches at first, then over everything
    float cover = max(smoothstep(1.0, -3.0, uSeaTemp - uLapse * wpos.y), uFreshSnow);
    if (cover > 0.0 && indexOf(s.g) != uWater && indexOf(s.g) != uGlass) {
      float lie = 0.55 * wn.y + 0.45 * big + (leaf - 0.5) * 0.1;
      float th = mix(1.15, 0.3, cover);
      float snow = smoothstep(th, th + 0.06, lie) * near;
      base = mix(base, paletteColor(float(uSnow)), snow);
      tex = mix(tex, 0.3, snow);
    }
    // rain darkens what faces the sky; on paving and bare earth it pools in puddles that
    // mirror the sky (drawn in once the light is worked out)
    float puddle = 0.0;
    if (uWet > 0.0 && indexOf(s.g) != uWater && indexOf(s.g) != uGlass) {
      float soaked = uWet * smoothstep(0.3, 0.8, wn.y) * (1.0 - cover);
      base *= 1.0 - 0.24 * soaked;
      if (seasonKindOf(s.g) < 0.5)
        puddle = soaked * smoothstep(0.96, 0.99, wn.y) * smoothstep(0.55, 0.65, big + (leaf - 0.5) * 0.15) * near;
    }
    float mott = ((big - 0.5) * 0.3 + (leaf - 0.5) * 0.35) * tex + (stroke - 0.5) * 0.06;
    base *= 1.0 + mott * near;
    // leaves and grass are painted in dabs: each clump its own stroke, blending into the next;
    // they blur into plain mottling far away where single dabs would only flicker
    float dabFade = near * (1.0 - smoothstep(35.0, 90.0, d)) * smoothstep(0.35, 0.8, tex);
    // strongest on leafy crowns, gentle on flat ground
    dabFade *= mix(1.0, 0.4, smoothstep(0.85, 0.98, wn.y));
    float dab = dabs(bp * 1.7);
    base *= 1.0 + dab * 0.16 * dabFade;
    // big fields of colour across meadows and hills: warm yellow-green here, cool blue-green there
    float field = fbm(wpos.xz * 0.011 + 3.0);
    vec3 warm = base * vec3(1.12, 1.07, 0.8);
    vec3 cool = base * vec3(0.88, 0.99, 1.06);
    base = mix(base, mix(cool, warm, smoothstep(0.32, 0.68, field)), tex * near);
    // sunlit dapples in foliage turn yellow-green
    base = mix(base, base * vec3(1.18, 1.14, 0.78), tex * smoothstep(0.55, 0.75, leaf) * 0.55 * near);

    // light: sun with a soft, slightly broken terminator; shadow takes the sky's cool blue
    float ndl = s.r * 2.0 - 1.0;
    // each dab catches the light a little differently, so a crown reads as many clumps
    float lit = smoothstep(-0.12, 0.38, ndl + (leaf - 0.5) * 0.25 * tex + dab * 0.55 * dabFade);
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
    // looking towards the sun, light shines through leaves, brightest at a crown's edges
    float edgeOn = 1.0 - abs(dot(wn, -rd));
    painted += tex * pow(max(0.0, dot(rd, uSun)), 3.0) * (0.4 + 0.6 * edgeOn) * vec3(0.2, 0.24, 0.05) * (1.0 - uNight) * near;
    col = mix(drainedOf(painted), painted, sat);
    if (puddle > 0.0) col = mix(col, skyPaint(reflect(rd, vec3(0.0, 1.0, 0.0))) * 0.85, puddle * 0.6);
    if (indexOf(s.g) == uWater) {
      // water mirrors the painted sky, more so at a glancing angle; slow ripple bands drift
      // across it and the sun glints off their crests
      vec2 rp = wpos.xz;
      float rip = vnoise(vec2(rp.x * 0.35 + uTime * 0.25, rp.y * 1.6)) * 0.6 + vnoise(rp * 2.3 - uTime * 0.4) * 0.4;
      vec3 rdir = reflect(rd, normalize(vec3((rip - 0.5) * 0.12, 1.0, (rip - 0.5) * 0.06)));
      float fres = 0.2 + 0.7 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 4.0);
      vec3 water = mix(paletteColor(s.g) * light, skyPaint(rdir), fres);
      water += vec3(0.92, 0.96, 1.0) * smoothstep(0.76, 0.8, rip) * 0.22 * lit * (1.0 - uNight);
      float glint = pow(max(0.0, dot(rdir, uSun)), 120.0) * step(0.55, vnoise(rp * 5.0 + uTime * 1.3));
      water += uSunColor * glint * 1.4 * (1.0 - uNight);
      col = mix(drainedOf(water), water, sat);
    }
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
    // mist and rain thicken it and pull it close
    col = mix(col, haze, (1.0 - exp(-d * (0.0042 + uFog * 0.035))) * mix(0.85, 0.97, uFog));
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
const _grey = new THREE.Vector3();
/** What a lightning flash adds to the light: a cold white-violet. */
const _flash = new THREE.Vector3(0.7, 0.72, 0.9);

const glowVert = postVert;
/** Bright parts of the painted frame, blurred along one axis (9 taps). With `uPick` set it
 * first keeps only what is brighter than the threshold. */
const glowFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uStep;
uniform float uPick;
vec3 pick(vec3 c) {
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  return uPick > 0.5 ? c * smoothstep(0.72, 1.0, l) : c;
}
void main() {
  vec3 sum = pick(texture2D(tSrc, vUv).rgb) * 0.227;
  for (int i = 1; i <= 4; i++) {
    float w = i == 1 ? 0.195 : i == 2 ? 0.122 : i == 3 ? 0.054 : 0.016;
    sum += pick(texture2D(tSrc, vUv + uStep * float(i) * 1.5).rgb) * w;
    sum += pick(texture2D(tSrc, vUv - uStep * float(i) * 1.5).rgb) * w;
  }
  gl_FragColor = vec4(sum, 1.0);
}`;
/** Adds the glow on top of the finished frame. */
const glowAddFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tGlow;
uniform float uStrength;
void main() { gl_FragColor = vec4(texture2D(tGlow, vUv).rgb * uStrength, 1.0); }`;

/**
 * The brush pass: turns the rendered frame into strokes of paint, then grades it like a
 * painting. A smooth Kuwahara filter looks at eight wedges of a circle around each pixel and
 * keeps the colour of the calmest ones, so areas break into rounded patches of paint with soft
 * edges while outlines stay sharp. Then: warm lift and a gentle S-curve, a little more colour, a
 * warm vignette, and a canvas weave with fine grain over everything.
 */
const brushFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uSpread;
uniform float uAspect;
uniform float uTime;
const float PI = 3.14159265;

/** Mean and spread of colour in one wedge of the circle around the pixel: the centre plus
 * two rings of three rays, 15 degrees apart. dir is the wedge's middle direction. */
void wedge(vec2 dir, vec3 centre, out vec3 mean, out float variance) {
  // ±15 degrees, without trigonometry per tap
  const float C = 0.9659258;
  const float S = 0.2588190;
  vec2 rays[3];
  rays[0] = vec2(dir.x * C - dir.y * S, dir.x * S + dir.y * C);
  rays[1] = dir;
  rays[2] = vec2(dir.x * C + dir.y * S, -dir.x * S + dir.y * C);
  vec3 sum = centre;
  vec3 sum2 = centre * centre;
  for (int ring = 1; ring <= 2; ring++)
    for (int ray = 0; ray < 3; ray++) {
      vec3 c = texture2D(tSrc, vUv + rays[ray] * (float(ring) * 1.5 * uSpread) * uTexel).rgb;
      sum += c;
      sum2 += c * c;
    }
  mean = sum / 7.0;
  vec3 v = abs(sum2 / 7.0 - mean * mean);
  variance = v.r + v.g + v.b;
}

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }

void main() {
  vec3 centre = texture2D(tSrc, vUv).rgb;
  vec3 acc = vec3(0.0);
  float total = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 mean;
    float variance;
    float ang = float(k) * (PI / 4.0);
    wedge(vec2(cos(ang), sin(ang)), centre, mean, variance);
    // calmer wedges count for much more (smooth rather than winner-takes-all, so no blocks)
    float w = 1.0 / (variance * 400.0 + 1e-3);
    w *= w;
    acc += mean * w;
    total += w;
  }
  vec3 col = acc / total;

  // brush streaks: fine ridges of paint dragged along the forms (across the local gradient),
  // stronger where the picture has structure, a soft cross-hatch of strokes where it is flat
  vec2 e = uTexel * uSpread * 2.0;
  vec2 grad = vec2(
    lum(texture2D(tSrc, vUv + vec2(e.x, 0.0)).rgb) - lum(texture2D(tSrc, vUv - vec2(e.x, 0.0)).rgb),
    lum(texture2D(tSrc, vUv + vec2(0.0, e.y)).rgb) - lum(texture2D(tSrc, vUv - vec2(0.0, e.y)).rgb));
  float edge = smoothstep(0.01, 0.08, length(grad));
  vec2 across = mix(normalize(vec2(0.6, 0.8)), normalize(grad + 1e-6), edge);
  vec2 along = vec2(-across.y, across.x);
  vec2 pp0 = gl_FragCoord.xy / max(uSpread, 1.0);
  float streak = vnoise(vec2(dot(pp0, along) * 0.07, dot(pp0, across) * 0.9));
  col *= 1.0 + (streak - 0.5) * mix(0.025, 0.12, edge);

  // grade like a painting: warm lift, gentle S-curve, a little more colour
  col = clamp(col * vec3(1.03, 1.0, 0.95) + vec3(0.022, 0.016, 0.004), 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
  float l = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(vec3(l), col, 1.1);
  // warm vignette
  vec2 q = vUv - 0.5;
  q.x *= uAspect;
  col *= mix(vec3(0.8, 0.76, 0.72), vec3(1.0), smoothstep(0.95, 0.38, length(q)));
  // canvas weave and fine grain
  vec2 pp = gl_FragCoord.xy;
  float weave = sin(pp.x * 1.7) * sin(pp.y * 1.7) * 0.012 + (hash(floor(pp / 3.0)) - 0.5) * 0.02;
  float grain = (hash(pp + fract(uTime * 7.0) * 113.0) - 0.5) * 0.025;
  col *= 1.0 + weave + grain;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** How strongly bright light blooms over its surroundings. */
const GLOW_STRENGTH = 0.32;

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
  /** Soft glow: bright parts at a quarter of the resolution, blurred both ways, added on top. */
  private readonly glowA: THREE.WebGLRenderTarget;
  private readonly glowB: THREE.WebGLRenderTarget;
  private readonly glowBlur: THREE.ShaderMaterial;
  private readonly glowAdd: THREE.ShaderMaterial;
  private readonly glowScene = new THREE.Scene();
  private readonly glowQuad: THREE.Mesh;
  /** The frame after the brush pass, before FXAA. */
  private readonly brushRt: THREE.WebGLRenderTarget;
  private readonly brush: THREE.ShaderMaterial;
  private readonly brushScene = new THREE.Scene();
  /** Pixels between brush-filter taps at 900 px tall (scaled with the frame); quality sets it. */
  private brushSpread = 2.8;
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
    weather: { cloud: 0, rain: 0, snowfall: 0, fog: 0, wet: 0, freshSnow: 0, windX: 0, windZ: 0, flash: 0 },
  };
  /** Rain, snow and lightning over the painted frame. */
  private readonly precipitation: Precipitation;
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
        uWater: { value: color('water') },
        uGrass: { value: color('grass') },
        uRock: { value: color('rock') },
        uSnow: { value: color('snow') },
        uSeasonKind: { value: perColor((c) => (c.season === 'meadow' ? 1 : c.season === 'leaf' ? 2 : 0), 0) },
        uMeadow: { value: SEASONS.map(({ meadow: m }) => new THREE.Vector4(...m.rgb, m.amount)) },
        uLeaf: { value: SEASONS.map(({ leaf: l }) => new THREE.Vector4(...l.rgb, l.amount)) },
        uLeafAlt: {
          value: SEASONS.map(({ leaf: l }) => new THREE.Vector4(...(l.alt ?? l.rgb), l.altShare ?? 0)),
        },
        uYear: { value: this.atmosphere.year },
        uStagger: { value: TUNING.season.stagger },
        uSeaTemp: { value: this.atmosphere.seaTemp },
        uLapse: { value: TUNING.season.lapse },
        uCloud: { value: 0 },
        uOvercast: { value: 0 },
        uFog: { value: 0 },
        uWet: { value: 0 },
        uFreshSnow: { value: 0 },
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
    this.precipitation = new Precipitation(depthTexture);
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
    const glowTarget = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(2, 2, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
    this.glowA = glowTarget();
    this.glowB = glowTarget();
    this.glowBlur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() }, uPick: { value: 0 } },
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.glowAdd = new THREE.ShaderMaterial({
      uniforms: { tGlow: { value: this.glowA.texture }, uStrength: { value: GLOW_STRENGTH } },
      vertexShader: glowVert,
      fragmentShader: glowAddFrag,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.glowQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.glowBlur);
    this.glowScene.add(this.glowQuad);
    this.brushRt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.brush = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: this.paintRt.texture },
        uTexel: { value: new THREE.Vector2() },
        uSpread: { value: 1 },
        uAspect: { value: 1 },
        uTime: { value: 0 },
      },
      vertexShader: postVert,
      fragmentShader: brushFrag,
      depthTest: false,
      depthWrite: false,
    });
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
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1);
    // smaller strokes on the faster setting (the filter cost does not change, the look does)
    this.brushSpread = quality === 'high' ? 2.8 : 2;
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
    this.brushRt.setSize(rw, rh);
    const bu = this.brush.uniforms;
    bu.uTexel!.value.set(1 / rw, 1 / rh);
    bu.uSpread!.value = this.brushSpread * Math.max(1, rh / 900);
    bu.uAspect!.value = w / h;
    this.glowA.setSize(Math.max(2, rw >> 2), Math.max(2, rh >> 2));
    this.glowB.setSize(Math.max(2, rw >> 2), Math.max(2, rh >> 2));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const u = this.post.uniforms;
    u.uRes!.value.set(rw, rh);
    u.uAspect!.value = w / h;
    this.fxaa.uniforms.resolution!.value.set(1 / rw, 1 / rh);
    this.precipitation.setSize(rw, rh);
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
    d.shade.lerp(d.sun, 0.35 * w.cloud);
    grey(d.sun, 0.4 * w.cloud, 1);
    grey(d.shade, 0.3 * w.cloud, 1);
    grey(d.zenith, 0.55 * w.cloud + 0.2 * falling, 1 - 0.25 * falling);
    grey(d.horizon, 0.45 * w.cloud + 0.2 * falling, 1 - 0.15 * falling);
    if (w.flash > 0)
      for (const v of [d.sun, d.shade, d.zenith, d.horizon]) v.addScaledVector(_flash, w.flash);
  }

  render(): void {
    this.camera.updateMatrixWorld();
    daylightAt(this.atmosphere.hour, this.atmosphere.declination, this.day);
    this.applyWeather();
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
    u.uYear!.value = this.atmosphere.year;
    u.uSeaTemp!.value = this.atmosphere.seaTemp;
    const w = this.atmosphere.weather;
    u.uCloud!.value = w.cloud;
    u.uOvercast!.value = Math.min(1, w.rain + w.snowfall);
    u.uFog!.value = w.fog;
    u.uWet!.value = w.wet;
    u.uFreshSnow!.value = w.freshSnow;
    // grass sways with the weather's wind
    shared.uWind.value.set(w.windX, w.windZ);
    u.uNight!.value = this.day.night;
    u.uTime!.value = performance.now() / 1000;
    shared.uTime.value = u.uTime!.value;
    r.setRenderTarget(this.paintRt);
    r.render(this.postScene, this.postCam);
    this.brush.uniforms.uTime!.value = u.uTime!.value;
    r.setRenderTarget(this.brushRt);
    r.render(this.brushScene, this.postCam);
    // after the brush pass, which would smear one-pixel streaks away
    this.precipitation.render(r, this.camera, { ...w, night: this.day.night }, u.uTime!.value);
    r.setRenderTarget(null);
    r.render(this.fxaaScene, this.postCam);
    this.renderGlow();
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

  /** Pick the bright parts, blur them across then down at quarter size, add them to the screen. */
  private renderGlow(): void {
    const r = this.renderer;
    const b = this.glowBlur.uniforms;
    const w = this.glowA.width;
    const h = this.glowA.height;
    this.glowQuad.material = this.glowBlur;
    b.tSrc!.value = this.paintRt.texture;
    b.uPick!.value = 1;
    b.uStep!.value.set(1 / w, 0);
    r.setRenderTarget(this.glowB);
    r.render(this.glowScene, this.postCam);
    b.tSrc!.value = this.glowB.texture;
    b.uPick!.value = 0;
    b.uStep!.value.set(0, 1 / h);
    r.setRenderTarget(this.glowA);
    r.render(this.glowScene, this.postCam);
    this.glowQuad.material = this.glowAdd;
    r.setRenderTarget(null);
    r.render(this.glowScene, this.postCam);
  }

  dispose(): void {
    this.precipitation.dispose();
    this.rt.dispose();
    this.shadowRt.dispose();
    this.shadowMaterial.dispose();
    this.paintRt.dispose();
    this.brushRt.dispose();
    this.brush.dispose();
    disposeTree(this.brushScene);
    this.glowA.dispose();
    this.glowB.dispose();
    this.glowBlur.dispose();
    this.glowAdd.dispose();
    disposeTree(this.postScene);
    disposeTree(this.fxaaScene);
    this.glowQuad.geometry.dispose();
    this.renderer.dispose();
  }
}

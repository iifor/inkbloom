// The paint pass's shader: one full-screen pass that reads the G-buffer (see ink-material.ts)
// and depth and paints the frame (see renderer.ts for the look). The sky and the water come in
// as chunks from sky-paint.ts and water-paint.ts.
import { MAX_COLORS, PALETTE, color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { BANK_HEIGHT, WATER_LEVEL } from '@/world/wilderness/generator';
import { wildernessDrainGLSL } from './ink-material';
import { LAMP_COUNT, LAMP_REACH, LIT_ROOMS } from './lamps';
import { surfaceLayer } from './painted-textures';
import { skyGLSL } from './sky-paint';
import {
  OWN_ARMS,
  WAKE_COUNT,
  mirrorGLSL,
  rainRingsGLSL,
  riverGLSL,
  wakeGLSL,
  waterGLSL,
} from './water-paint';

/** Flower seas the paint pass washes in at once (the nearest). */
export const SEA_SLOTS = 6;

/** Cells on a side of the value-noise lattice (see makeNoise); the pattern repeats this often. */
export const NOISE_SIZE = 256;
/** The brush's colours come first in the palette; walls and doors are painted in them. */
const PAINTABLE_COUNT = PALETTE.findIndex((c) => !c.paintable);

/** A full-screen quad, for this pass and the ones after it. */
export const postVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const postFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uReversedDepth;
uniform sampler2D uNoise;
uniform sampler2D uRivers;
uniform vec4 uRiverGrid;
uniform float uAspect;
uniform vec3 uColors[${MAX_COLORS}];
uniform float uSolid[${MAX_COLORS}];
uniform float uTexture[${MAX_COLORS}];
uniform mat4 uInvProj;
uniform mat4 uInvView;
/** World to clip space, for finding where a reflected ray lands on the screen. */
uniform mat4 uViewProj;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uShade;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uNight;
uniform int uGlass;
uniform int uWater;
uniform bool uWildWater;
uniform vec4 uWakes[${WAKE_COUNT}];
uniform int uGrass;
uniform int uSand;
uniform int uRock;
uniform int uSnow;
uniform int uCedar;
uniform sampler2D uCanopyBrush;
/** Hand-painted grey tiles of brushwork, a layer for each kind of surface (painted-textures.ts):
 * 0.5 changes nothing. And the cumulus atlas the sky is painted from (sky-paint.ts). */
uniform highp sampler2DArray uSurfaces;
uniform sampler2D uClouds;
/** Painted rooms seen through lit windows at night: six columns by four rows. */
uniform sampler2D uInteriors;
/** Lit windows near by (lamps.ts): where each lamp is, and how strongly it shines (0 none). */
uniform vec4 uLamps[${LAMP_COUNT}];
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
uniform vec2 uDrift;
uniform float uCloudShade;
/** How bright a rainbow is (0 none), and how much hoar frost lies on the ground. */
uniform float uRainbow;
uniform float uFrost;
/** Rain falling (not snow), 0..1: drops ring the water where they land. */
uniform float uRainfall;
/** Flower seas near by (world/wilderness/groves.ts): x, z, radius (0 for none), and the palette
 * index of their colour plus how far in bloom (0..1) times 0.9; then their edge's lobe phases. */
uniform vec4 uSeas[${SEA_SLOTS}];
uniform vec4 uSeaLobes[${SEA_SLOTS}];
/** A warm spot (a hot spring): x, z, radius; snow will not lie within a few metres of it. */
uniform vec4 uWarm;
uniform float uSkySat;
uniform float uGloom;
uniform float uTime;
${wildernessDrainGLSL}

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
/** Value noise: random values on a unit lattice, blended with smoothstep weights. The lattice
 * is a small texture of random values, so the GPU's own bilinear filter does the four-corner
 * blend in one read (the smoothed fraction picks where between the texel centres it reads). */
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return texture2D(uNoise, (i + f + 0.5) / ${NOISE_SIZE}.0).r;
}
${riverGLSL}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.48; }
  return v;
}
/** Two octaves: enough for broad shapes (cloud warping, far ridges, fields of colour). The
 * constant stands in for the dropped octaves' average, so it centres where fbm does. */
float fbm2(vec2 p) { return 0.5 * vnoise(p) + 0.24 * vnoise(p * 2.03 + 17.1) + 0.085; }
/** A painted tile at uv (one repeat a unit), as the change it makes: about -0.4..0.4, and 0
 * far off, where the tile has settled into its mid-grey. */
float tileOf(int layer, vec2 uv) { return texture(uSurfaces, vec3(uv, float(layer))).r - 0.5; }
float linDepth(float z) {
  if (uReversedDepth > 0.5) return uNear * uFar / (uNear + z * (uFar - uNear));
  float zn = z * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - zn * (uFar - uNear));
}
// palette lookups index the uniform arrays directly (WebGL 2 allows it): one read, not a scan
int indexOf(float code) { return clamp(int(floor(code + 0.0005)), 0, ${MAX_COLORS} - 1); }
vec3 paletteColor(float code) { return uColors[indexOf(code)]; }
float solidOf(float code) { return uSolid[indexOf(code)]; }
float textureOf(float code) { return uTexture[indexOf(code)]; }
/** 0 unchanged by the seasons, 1 meadow (ground, grass), 2 broadleaf crowns. */
float seasonKindOf(float code) { return uSeasonKind[indexOf(code)]; }
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
/** The page under this pixel (set in main before anything is drained): the pen hatching here
 * (1 bare paper .. 0 a line), the paper's grain, and how heavily this part of the picture is
 * drawn (the sky is drawn lightly). */
float pageHatch = 1.0;
float pageGrain = 0.0;
float pageWeight = 1.0;
const vec3 PEN = vec3(0.26, 0.17, 0.12);
/**
 * A drained colour: the same picture as a page of an unpainted comic. Warm paper, a thin wash
 * for its tones, pen hatching where it is dark (denser the darker, solid ink in the deepest
 * shade), all in sepia. Painting a place lays its colours over this drawing.
 */
vec3 drainedOf(vec3 c) {
  float dark = (1.0 - dot(c, vec3(0.3, 0.59, 0.11))) * pageWeight;
  // (kept under the brightness that glows, or a sunlit street would bloom to white)
  vec3 paper = vec3(0.86, 0.8, 0.69) * (1.0 + pageGrain * 0.5) * mix(1.0, 0.7, smoothstep(0.12, 0.8, dark));
  float ink = (1.0 - pageHatch) * smoothstep(0.26, 0.6, dark) * 1.5 + smoothstep(0.78, 0.95, dark) * 0.7;
  return mix(paper, PEN, clamp(ink, 0.0, 1.0));
}
/** Drained, as the light allows: by day the pen drawing on its paper; by night a dark grey that
 * takes the moonlight's blue, instead of a page that glows in the dark. */
vec3 drainedAt(vec3 c) {
  vec3 night = greyOf(c) * vec3(0.8, 0.92, 1.25) + vec3(0.012, 0.02, 0.05);
  return mix(drainedOf(c), night, uNight);
}

${skyGLSL}

${wakeGLSL}

${mirrorGLSL}

${rainRingsGLSL}

void main() {
  vec2 px = 1.0 / uRes;
  vec4 s = texture2D(tScene, vUv);
  float raw = texture2D(tDepth, vUv).x;
  // (what the G-buffer held, before it is read apart below: the pen's outlines compare it)
  vec4 held = s;
  float d = linDepth(raw);
  bool sky = uReversedDepth > 0.5 ? raw <= 0.0 : raw >= 0.99999;
  vec2 pp = gl_FragCoord.xy;
  // the view ray through this pixel, then out along it to the linear depth: unprojecting the
  // stored depth instead would round far off, and the brushwork keyed to world positions
  // would swim on distant houses
  vec4 cn = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 ray = cn.xyz / cn.w;
  vec3 vpos = sky ? ray : ray * (d / -ray.z);
  vec3 rd = normalize(mat3(uInvView) * normalize(vpos));
  float skySat = uSkySat * (1.0 - uGloom);
  vec3 col;
  float paintAlpha = 1.0;
  if (sky) {
    // the page here (see drainedOf): the sky is hatched only lightly, by where one looks
    vec2 skyAt = rd.xz / (abs(rd.y) + 0.4) * 1.3;
    pageHatch = tileOf(${surfaceLayer('hatching')}, skyAt) + 0.5;
    pageGrain = tileOf(${surfaceLayer('paper')}, skyAt * 1.7);
    pageWeight = 0.8;
    vec3 painted = skyPaint(rd);
    vec4 ranges = farRanges(rd);
    painted = mix(painted, ranges.rgb, ranges.w * (1.0 - uNight * 0.5));
    if (uRainbow > 0.0) painted = withRainbow(painted, rainbowOf(rd) * vec4(1.0, 1.0, 1.0, uRainbow));
    // drained: an overcast grey version of the same sky
    col = mix(drainedAt(painted), painted, skySat);
  } else {
    vec3 wpos = (uInvView * vec4(vpos, 1.0)).xyz;
    // the swimmer's own arms under the surface waver as the water moves over them: read the
    // frame a little to one side, where that is still the arm (not the lake behind it)
    if (uWildWater && d < ${OWN_ARMS.toFixed(1)} && wpos.y < ${WATER_LEVEL}) {
      vec2 wob = vec2(sin(vUv.y * 90.0 + uTime * 3.1), cos(vUv.x * 70.0 + uTime * 2.3)) * 0.0035;
      wob *= smoothstep(0.0, 0.04, ${WATER_LEVEL} - wpos.y);
      if (linDepth(texture2D(tDepth, vUv + wob).x) < ${OWN_ARMS.toFixed(1)}) s = texture2D(tScene, vUv + wob);
    }
    // a window pane carries where on the pane this is instead of its normal (ink-material.ts):
    // its normal is found from the lie of the surface
    bool pane = s.b > 7.0;
    vec2 paneAt = vec2(s.b - 8.0, fract(s.a));
    float room = floor(s.a);
    if (pane) {
      vec3 flat_ = normalize(cross(dFdx(vpos), dFdy(vpos)));
      s.ba = (flat_.z < 0.0 ? -flat_ : flat_).xy;
    }
    // people in cloth carry their normal's x lifted out of range (ink-material.ts CLOTH)
    bool figure = s.b > 3.0;
    if (figure) {
      s.b -= 4.0;
      // people are cels laid over the painting: flat colour that the brush pass leaves alone
      paintAlpha = 1.0;
    }
    bool fish = s.b < -1.5;
    vec3 fishPaint = vec3(-2.0 - s.b, s.g, s.a);
    if (fish) {
      s.g = ${color('teal')}.9;
      paintAlpha = 0.90;
    }
    vec3 nView = vec3(s.ba, sqrt(max(0.0, 1.0 - dot(s.ba, s.ba))));
    bool grassBlade = s.b > 1.5;
    vec3 wn = (grassBlade || fish) ? vec3(0.0, 1.0, 0.0) : normalize(mat3(uInvView) * nView);
    if (grassBlade) paintAlpha = 0.75 * s.a;
    bool ground = s.g < 0.0;
    bool petal = s.g >= ${MAX_COLORS}.0;
    // A drained index lies exactly on an integer. Interpolation followed by
    // half-float storage can round it down one ULP, into the previous pigment.
    // Ordinary saturation occupies only the lower 0.90 of each palette slot.
    if (!ground && !petal && fract(s.g) > 0.96) s.g = ceil(s.g);
    bool meadowPetal = s.g >= ${2 * MAX_COLORS}.0;
    float petalWash = fract(s.g);
    if (petal) s.g = floor(s.g) - (meadowPetal ? ${2 * MAX_COLORS}.0 : ${MAX_COLORS}.0) + 0.9;
    float meadow = clamp(-1.0 - s.g, 0.0, 1.0);
    float sat = (ground || meadowPetal) ? derivedSat(wpos) * uSceneSat : satOf(s.g);
    if (ground) s.g = float(uGrass);
    float tex = fish ? 0.0 : textureOf(s.g);
    float seasonKind = seasonKindOf(s.g);
    vec3 base = seasonal(paletteColor(s.g), seasonKind, wpos.xz);
    int pigment = indexOf(s.g);
    bool skinPigment = pigment == ${color('skinLight')} || pigment == ${color('skinWarm')} || pigment == ${color('skinDeep')};
    if (figure && skinPigment) tex = 0.0;
    if (figure && !skinPigment) {
      // Clothes use sun-faded pigments and warm paper whites. Palette/save data
      // remains unchanged; the environment keeps its existing painted colours.
      float luminance = dot(base, vec3(0.3, 0.59, 0.11));
      base = mix(base, vec3(luminance) * vec3(1.04, 1.01, 0.94), 0.16);
      base = mix(base, vec3(0.90, 0.83, 0.69), 0.055);
      tex *= 0.55;
    }
    // At first-person distance the skin needs a broad warm shading ramp; the
    // world's cel-shadow threshold otherwise turns small joints into purple blocks.
    bool nearSkin = figure && d < 0.85 && (pigment == ${color('skinLight')} || pigment == ${color('skinWarm')} || pigment == ${color('skinDeep')});
    bool cedar = pigment == uCedar;
    bool crown = cedar || seasonKind > 1.5;

    // brush texture, anchored to the world (held tools ride with the camera: keep them clean)
    vec3 an = abs(wn);
    vec2 bp = an.y > max(an.x, an.z) ? wpos.xz : (an.x > an.z ? wpos.zy : wpos.xy);
    // A continuous oblique projection keeps brush marks intact across rounded boughs.
    if (crown) bp = vec2(wpos.x + 0.51 * wpos.z, wpos.y - 0.63 * wpos.z);
    float near = (ground || grassBlade || crown) ? 1.0 : smoothstep(1.5, 3.0, d);
    float big = fbm(bp * 0.18);
    float leaf = fbm(bp * 1.3 + 7.0);
    float stroke = vnoise(vec2(bp.x * 2.5, bp.y * 0.6));
    // The painted tiles. Every surface takes the dry brush; built things also wear the tile of
    // what they are made of, laid along the surface: roofs in rows up the slope, walls and
    // doors upright, paving and decks flat. Both are read here, once for every pixel and
    // outside any branch, so the GPU can tell how far apart its samples lie.
    bool built = !figure && !petal && !ground && !grassBlade && !fish;
    float across = an.x > an.z ? wpos.z : wpos.x;
    bool roof = built && (pigment == ${color('clayTile')} || pigment == ${color('slateTile')}) && wn.y > 0.15;
    bool wall = built && (pigment < ${PAINTABLE_COUNT} || pigment == ${color('limewash')}) && an.y < 0.6;
    bool paving = built && pigment == ${color('stone')} && wn.y > 0.8;
    bool deck = built && (pigment == ${color('bark')} || pigment == ${color('brown')}) && wn.y > 0.75;
    bool joinery = built && pigment == ${color('brown')} && an.y < 0.7;
    bool boulder = built && pigment == ${color('rock')};
    int tile = 0;
    vec2 tileAt = vec2(0.0);
    float tileOn = 1.0;
    if (roof) {
      tile = pigment == ${color('clayTile')} ? ${surfaceLayer('roof_clay')} : ${surfaceLayer('roof_slate')};
      // rows climb the slope (a flat roof is laid like a floor)
      tileAt = wn.y > 0.93 ? wpos.xz / 3.0 : vec2(across, -wpos.y / max(sqrt(1.0 - wn.y * wn.y), 0.35)) / 3.0;
    } else if (wall) { tile = ${surfaceLayer('plaster')}; tileAt = vec2(across, -wpos.y) / 3.2; }
    else if (paving) { tile = ${surfaceLayer('paving')}; tileAt = wpos.xz / 3.4; }
    // (bridges run east and west, so their planks lie along z)
    else if (deck) { tile = ${surfaceLayer('timber')}; tileAt = wpos.xz / 2.4; }
    else if (joinery) { tile = ${surfaceLayer('timber')}; tileAt = vec2(across, -wpos.y) / 2.4; }
    else if (boulder) { tile = ${surfaceLayer('stone')}; tileAt = bp / 2.8; }
    else tileOn = 0.0;
    float laid = tileOf(tile, tileAt) * tileOn;
    float brush = fish ? 0.0 : tileOf(${surfaceLayer('drybrush')}, bp / 2.7);
    // the page here (see drainedOf): hatching and paper lie on the surfaces, like the brush
    pageHatch = tileOf(${surfaceLayer('hatching')}, bp / 2.4) + 0.5;
    pageGrain = tileOf(${surfaceLayer('paper')}, bp / 1.9);
    // far off the drawing thins to bare paper, as the far side of a sketch is left unfinished
    // (its tones alone, without their hatching, turn to mud in the haze)
    pageWeight = mix(1.0, 0.45, smoothstep(35.0, 150.0, d));

    // Overlapping rows of hand-laid tiles, each its own tone, dark where one laps the next.
    // Far off the rows settle into a single wash, with no shimmer.
    if (roof) {
      float joint = smoothstep(-0.1, -0.28, laid);
      base *= 1.0 + laid * 1.5;
      // patches of faded and darker tiles that still read from across the street
      float patchy = fbm2(wpos.xz * 0.6 + across * 0.3);
      base *= 0.86 + 0.28 * patchy;
      base = mix(base, vec3(dot(base, vec3(0.3, 0.59, 0.11))) * vec3(1.05, 1.0, 0.93), 0.22);
      // old roofs carry moss in patches, thickest where the tiles lap
      float moss = smoothstep(0.55, 0.72, fbm2(wpos.xz * 0.4 + 7.0) + laid * 0.6);
      base = mix(base, base * vec3(0.66, 0.92, 0.46) + vec3(0.03, 0.06, 0.0), moss * (0.5 + 0.35 * joint));
    }
    // A coloured wall is a wash over plaster, not a flat block: long strokes run down it,
    // the plaster shows through where the wash is thin, and the colour is a little softer.
    // Far off it settles into one colour again.
    if (wall) {
      float streak = vnoise(vec2(across * 4.5, wpos.y * 0.6)) * 0.6 + vnoise(vec2(across * 11.0, wpos.y * 1.4)) * 0.4;
      float wallNear = near * (1.0 - smoothstep(45.0, 130.0, d));
      float thin = smoothstep(0.5, 0.78, big + (leaf - 0.5) * 0.4 + (streak - 0.5) * 0.25);
      base = mix(base, paletteColor(${color('limewash')}.0), 0.3 * thin * wallNear);
      base *= 1.0 + (streak - 0.5) * 0.28 * wallNear;
      // the plaster under it, laid on in overlapping patches
      base *= 1.0 + laid * 0.55 * near;
      // rain has run down it in long darker streaks from sills and eaves, fading as they go
      float column = smoothstep(0.6, 0.85, vnoise(vec2(across * 3.1, 7.3)));
      float run = vnoise(vec2(across * 3.1, wpos.y * 0.45 + 3.0));
      base *= 1.0 - 0.13 * column * smoothstep(0.35, 0.7, run) * wallNear;
      // a painter's mix, not a tube colour: greyer and warmer than the pigment, with some of
      // the plaster's own colour in it, so a street of painted houses sits together
      base = mix(vec3(dot(base, vec3(0.3, 0.59, 0.11))) * vec3(1.04, 1.0, 0.92), base, 0.64);
      base = mix(base, paletteColor(${color('limewash')}.0), 0.12);
    }
    // Bark in long broken strokes up the trunk, cooler and a little mossy in the furrows
    if (!figure && pigment == ${color('bark')} && an.y < 0.7) {
      float furrow = vnoise(vec2(across * 9.0, wpos.y * 0.9)) * 0.65 + vnoise(vec2(across * 23.0, wpos.y * 2.1)) * 0.35;
      base *= 1.0 + (furrow - 0.5) * 0.4 * near;
      base = mix(base, base * vec3(0.82, 0.98, 0.86), smoothstep(0.55, 0.3, furrow) * 0.6 * near);
    }
    // Paved streets and squares: hand-laid stones in staggered rows, each its own tone, worn
    // smoother in places.
    if (paving) {
      float worn = mix(0.55, 1.0, smoothstep(0.42, 0.72, big + (leaf - 0.5) * 0.7));
      float joint = smoothstep(-0.1, -0.28, laid) * worn;
      base *= 1.0 + laid * 1.5 * worn;
      // and grimy where many feet and cartwheels go, mossy in the joints at the edges
      base = mix(base, base * vec3(0.84, 0.82, 0.76), smoothstep(0.45, 0.7, big) * 0.4);
      base = mix(base, base * vec3(0.78, 0.92, 0.66), joint * smoothstep(0.55, 0.75, leaf) * 0.6);
    }
    // Trodden earth (footpaths, yards): gritty, with small stones pressed into it, darker in
    // damp patches; the stones go into the grit where they would be under a pixel.
    if (!figure && !petal && !ground && pigment == ${color('sand')} && wn.y > 0.75) {
      vec2 q = wpos.xz * 3.4;
      vec2 cell = floor(q);
      vec2 at = fract(q) - 0.5 - (hash22(cell) - 0.5) * 0.45;
      float size = 0.13 + 0.17 * hash21(cell + 9.1);
      float stone = step(0.72, hash21(cell + 3.3)) * (1.0 - smoothstep(size * 0.45, size, length(at)));
      vec2 footprint = fwidth(q);
      stone *= 1.0 - smoothstep(0.2, 0.5, max(footprint.x, footprint.y));
      // each stone its own pale grey-brown, lit on the sun's side and shaded on the other
      vec3 pebble = mix(paletteColor(${color('rock')}.0), base, 0.55) * mix(0.9, 1.12, hash21(cell + 5.5));
      pebble *= 1.0 - 0.18 * dot(normalize(at + 1e-4), normalize(uSun.xz + 1e-4));
      base = mix(base, pebble, stone * 0.7);
      float grit = vnoise(wpos.xz * 11.0) * 0.6 + vnoise(wpos.xz * 27.0) * 0.4;
      base *= 1.0 + ((grit - 0.5) * 0.16 * (1.0 - smoothstep(4.0, 25.0, d)) + (big - 0.5) * 0.22) * near;
      base = mix(base, base * vec3(0.8, 0.76, 0.7), smoothstep(0.58, 0.75, big + (leaf - 0.5) * 0.5) * 0.45);
    }
    // Wood (decks and boards laid flat, doors and posts upright): grain along the plank, each
    // plank its own tone, the odd knot; grey where the weather gets at it
    if (deck || joinery) {
      base *= 1.0 + laid * 1.5;
      base = mix(base, vec3(dot(base, vec3(0.3, 0.59, 0.11))) * vec3(1.0, 0.98, 0.95), 0.18 + 0.2 * (big - 0.5));
    }
    // Stone (boulders, cairns, rims, old walls): broken into planes by the brush, pale lichen
    // on the faces that catch the rain, and dark cracks; both fade out with distance
    if (boulder) {
      base *= 1.0 + laid * 0.6 * near;
      float lichen = smoothstep(0.66, 0.74, vnoise(bp * 2.6 + 4.0) + 0.25 * wn.y + (leaf - 0.5) * 0.3);
      base = mix(base, mix(base, vec3(0.86, 0.87, 0.78), 0.45), lichen * 0.4 * near);
      // fine cracks, broken into short runs rather than one line wandering over the stone
      float crack = 1.0 - smoothstep(0.0, 0.018, abs(vnoise(bp * 3.4 + 11.0) - 0.5));
      crack *= smoothstep(0.55, 0.7, vnoise(bp * 1.3 + 2.0));
      base *= 1.0 - 0.2 * crack * near * (1.0 - smoothstep(4.0, 20.0, d));
    }
    // where meadow ground gets steep, bare rock shows through, with a ragged painted edge
    if (grassBlade) {
      // Keep the base of a leaf in the shade and let its lit edge separate from the soil
      // even at noon, when both are otherwise on the sunlit end of the lighting ramp.
      base *= mix(0.69, 0.94, smoothstep(0.25, 0.95, s.r));
      tex *= 0.48;
    } else if (indexOf(s.g) == uGrass) {
      float steep = 1.0 - smoothstep(0.62, 0.74, wn.y + (big - 0.5) * 0.18 + (leaf - 0.5) * 0.08);
      base = mix(base, paletteColor(float(uRock)), steep);
      tex = mix(tex, 0.7, steep);
      // the meadow floor is mostly seen between the grass, down in its shade
      base *= mix(0.78, 1.0, steep);
      if (ground) {
        // Anchor the transition to the actual shore. Painted variation breaks up the
        // tideline without shifting either the water surface or the player's footing.
        float bank = wpos.y - (${WATER_LEVEL}) + (big - 0.5) * 0.38 + (leaf - 0.5) * 0.13;
        meadow *= smoothstep(0.0, ${BANK_HEIGHT}, bank);
        vec3 sand = paletteColor(float(uSand)) * mix(0.78, 1.0, smoothstep(-0.15, 0.45, bank));
        base = mix(sand, base, meadow);
        tex = mix(textureOf(float(uSand)), tex, meadow);
      }
    }
    // a flower sea: close by its flowers stand on their own over the meadow; further off they
    // melt into a broken wash of their colour (the same lobed edge as groves.ts patchMask)
    if ((ground || grassBlade) && uSeas[0].z > 0.0) {
      float bloom = 0.0;
      float hue = 0.0;
      for (int i = 0; i < ${SEA_SLOTS}; i++) {
        vec4 sea = uSeas[i];
        if (sea.z <= 0.0) continue;
        vec2 o = wpos.xz - sea.xy;
        float dd = length(o);
        if (dd > sea.z * 1.3) continue;
        float a = atan(o.y, o.x);
        float edge = sea.z * (1.0 + 0.16 * sin(3.0 * a + uSeaLobes[i].x) + 0.09 * sin(5.0 * a + uSeaLobes[i].y));
        float m = smoothstep(edge, edge * 0.7, dd) * fract(sea.w) / 0.9;
        if (m > bloom) { bloom = m; hue = floor(sea.w); }
      }
      if (bloom > 0.0) {
        float blot = smoothstep(0.25, 0.65, leaf + (big - 0.5) * 0.9);
        float far = mix(0.35, 0.8, smoothstep(10.0, 60.0, d));
        base = mix(base, paletteColor(hue) * mix(0.85, 1.08, leaf), bloom * blot * far * (ground ? meadow : 0.7));
      }
    }
    // snow lies on what faces up wherever the day's mean temperature is below freezing (colder
    // higher up), in patches at first, then over everything
    float cover = max(smoothstep(1.0, -3.0, uSeaTemp - uLapse * wpos.y), uFreshSnow);
    if (uWarm.z > 0.0) cover *= smoothstep(uWarm.z + 0.5, uWarm.z + 14.0, distance(wpos.xz, uWarm.xy));
    if (!fish && cover > 0.0 && indexOf(s.g) != uWater && indexOf(s.g) != uGlass) {
      float lie = 0.55 * wn.y + 0.45 * big + (leaf - 0.5) * 0.1;
      float th = mix(1.15, 0.3, cover);
      float snow = smoothstep(th, th + 0.06, lie) * near;
      base = mix(base, paletteColor(float(uSnow)), snow);
      tex = mix(tex, 0.3, snow);
    }
    // hoar frost: a pale rime on what faces up, in a fine broken film; it lasts in the shade
    // after the sunlit ground has thawed
    if (uFrost > 0.0 && !fish && indexOf(s.g) != uWater && indexOf(s.g) != uGlass) {
      float sunny = smoothstep(-0.1, 0.4, s.r * 2.0 - 1.0);
      float rime = uFrost * mix(1.0, 0.3, sunny) * (1.0 - cover) * smoothstep(0.25, 0.7, wn.y);
      rime *= smoothstep(0.25, 0.6, leaf + (big - 0.5) * 0.6) * (crown ? 0.55 : 1.0);
      base = mix(base, paletteColor(float(uSnow)) * vec3(0.93, 0.97, 1.04), rime * 0.75 * near);
      tex = mix(tex, 0.35, rime);
    }
    // rain darkens what faces the sky; on paving and bare earth it pools in puddles that
    // mirror the sky (drawn in once the light is worked out)
    float puddle = 0.0;
    if (!fish && uWet > 0.0 && indexOf(s.g) != uWater && indexOf(s.g) != uGlass) {
      float soaked = uWet * smoothstep(0.3, 0.8, wn.y) * (1.0 - cover);
      base *= 1.0 - 0.24 * soaked;
      float bare = ground ? 1.0 - meadow : (seasonKindOf(s.g) < 0.5 ? 1.0 : 0.0);
      if (!petal) puddle = bare * soaked * smoothstep(0.96, 0.99, wn.y) * smoothstep(0.55, 0.65, big + (leaf - 0.5) * 0.15) * near;
    }
    // the bank is dark and wet for a hand's breadth above the water
    if (uWildWater && !fish && !grassBlade && !petal)
      base *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.16, wpos.y - (${WATER_LEVEL}))) * step(${WATER_LEVEL}, wpos.y);
    float mott = ((big - 0.5) * 0.3 + (leaf - 0.5) * 0.35) * tex + (stroke - 0.5) * 0.06;
    // and the dry brush over everything: strongest in leaves and grass, faint on cloth
    mott += brush * (figure ? 0.04 : mix(0.22, 0.5, tex));
    // Open ground is laid in with a broad brush: big strokes a stride or two across, each a
    // little lighter or darker and leaning warm or cool, so a meadow or a path is worked paint
    // like the sky and the trees round it and never one flat field of colour.
    float broadBrush = fish || figure ? 0.0 : tileOf(${surfaceLayer('drybrush')}, bp / 9.5 + 0.31);
    float open = (ground || grassBlade || pigment == ${color('sand')}) ? 1.0 : 0.35 * tex;
    mott += broadBrush * 1.2 * open;
    base = mix(base, base * (broadBrush > 0.0 ? vec3(1.1, 1.05, 0.84) : vec3(0.9, 0.98, 1.06)), min(abs(broadBrush) * 5.0, 1.0) * 0.5 * open * near);
    base *= 1.0 + mott * near;
    // leaves and grass are painted in dabs: each clump its own stroke, blending into the next;
    // they blur into plain mottling far away where single dabs would only flicker
    float dabFade = near * (1.0 - smoothstep(35.0, 90.0, d)) * (crown ? 1.0 : smoothstep(0.35, 0.8, tex));
    // strongest on leafy crowns, gentle on flat ground
    if (!crown) dabFade *= mix(1.0, 0.4, smoothstep(0.85, 0.98, wn.y));
    // only where it shows (leafy, near): walls, roads and the distance skip the work
    float dab = 0.0;
    float canopyWash = 0.0;
    if (!grassBlade && dabFade > 0.001) {
      if (crown) {
        // The leaf clusters, laid on from three sides and blended by which way the bough
        // faces: a single projection drags the leaves into streaks where it lies along the
        // surface (over the top of the crown, and round one flank).
        vec3 brush = texture2D(uCanopyBrush, bp * 0.41 + big * 0.12).rgb;
        vec3 sideBrush = texture2D(uCanopyBrush, vec2(wpos.z - 0.45 * wpos.x, wpos.y + 0.65 * wpos.x) * 0.41).rgb;
        vec3 topBrush = texture2D(uCanopyBrush, vec2(wpos.x + 0.3 * wpos.y, wpos.z + 0.2 * wpos.y) * 0.41).rgb;
        vec3 facing = abs(vec3(dot(wn, vec3(-0.39, 0.48, 0.78)), dot(wn, vec3(0.78, -0.51, 0.35)), dot(wn, vec3(-0.28, 0.94, -0.19))));
        facing = pow(facing, vec3(6.0));
        brush = (brush * facing.x + sideBrush * facing.y + topBrush * facing.z) / (facing.x + facing.y + facing.z + 1e-4);
        dab = (cedar ? brush.g : brush.r) - 0.45;
        canopyWash = (brush.b - 0.46) * dabFade;
      }
      #ifndef CHEAP
      // (the low quality setting leaves the ground's dabs out: a cell search per pixel)
      else dab = dabs(bp * 1.7);
      #endif
    }
    base *= 1.0 + dab * 0.16 * dabFade;
    // big fields of colour across meadows and hills: warm yellow-green here, cool blue-green there
    float field = fbm2(wpos.xz * 0.011 + 3.0);
    vec3 warm = base * vec3(1.12, 1.07, 0.8);
    // (in grass and leaves the cool fields are also deeper: emerald against the sunny yellow-green)
    vec3 cool = base * mix(vec3(0.88, 0.99, 1.06), vec3(0.78, 0.93, 0.92), smoothstep(0.5, 1.0, tex));
    // (on smooth things too, a little: no surface in a painting is one flat colour)
    float fieldAmt = figure ? tex : max(tex, 0.4);
    base = mix(base, mix(cool, warm, smoothstep(0.32, 0.68, field)), fieldAmt * near);
    // sunlit dapples in foliage turn yellow-green
    base = mix(base, base * vec3(1.18, 1.14, 0.78), tex * smoothstep(0.55, 0.75, leaf) * 0.55 * near);

    // Light, in the steps of a painted cel: shade, the thing's own colour in the light, and
    // full sun on what faces it squarely. The edge between shade and light is firm, and broken
    // by the brush, as a painter leaves it.
    float ndl = s.r * 2.0 - 1.0;
    // each dab catches the light a little differently, so a crown reads as many clumps
    float turned = ndl + (leaf - 0.5) * 0.25 * tex + dab * 0.55 * dabFade + brush * (figure ? 0.08 : 0.45);
    // (meadows keep a soft turn: a blade from its shaded foot to its lit tip, and the ground
    // under it over the roll of a hill, so the two stay in step when the sun is low)
    float lit = (grassBlade || ground) ? smoothstep(-0.12, 0.38, turned) : smoothstep(0.0, 0.15, turned);
    // (a person's shade keeps a slightly softer edge: the shadow of an arm across a chest is
    // only a few of the shadow map's steps wide, and a hard edge would show them)
    if (figure) lit = smoothstep(-0.12, 0.36, turned);
    if (figure && skinPigment) lit = smoothstep(-0.3, 0.5, turned);
    if (nearSkin) {
      // Broad fill preserves the palm and knuckle volume when the world shadow
      // map covers the whole hand with the same value.
      float form = dot(normalize(nView), normalize(vec3(-0.5, 0.6, 0.65)));
      lit = mix(smoothstep(-0.75, 1.0, ndl), smoothstep(-0.25, 1.0, form), 0.65) * 0.85;
    }
    float full = smoothstep(0.5, 0.72, turned);
    if (fish) {
      base = fishPaint;
      lit = mix(0.25, 0.90, smoothstep(-0.85, 0.90, ndl));
      full = 0.0;
    }
    // shade is the sky's blue leaning to violet, and deeper by day than the fill light alone
    float byDay = 1.0 - 0.6 * uNight;
    vec3 shadowTint = uShade * mix(vec3(1.0), vec3(0.82, 0.79, 0.96), byDay) * mix(0.9, 1.08, 0.5 + 0.5 * wn.y);
    // leaves and grass go deeper and blue-green in shade
    shadowTint = mix(shadowTint, uShade * mix(vec3(0.76, 0.88, 0.8), vec3(0.52, 0.8, 0.78), byDay), tex * 0.7);
    // (wood in shade is warm and never near black: light comes back up off the ground, and a
    // bridge or a post should sit in the picture's key, not be its darkest thing)
    bool timber = built && (pigment == ${color('bark')} || pigment == ${color('brown')}) && !crown;
    if (timber) shadowTint = shadowTint * 1.3 + vec3(0.09, 0.06, 0.03) * byDay;
    if (nearSkin) shadowTint = mix(shadowTint, uSunColor * vec3(0.65, 0.46, 0.34), 0.72 * (1.0 - uNight));
    else if (figure) shadowTint = mix(shadowTint, uShade * vec3(1.12, 1.04, 0.96), 0.22);
    vec3 light = mix(shadowTint, uSunColor * (0.96 + 0.08 * full), lit);
    if (nearSkin) light *= 0.82;
    else if (figure && skinPigment) light *= 0.88;
    // on a broken-cloud day the clouds' shadows sail across the land with the wind
    if (uCloudShade > 0.0) {
      float cs = fbm2((wpos.xz - uDrift) * 0.006 + 11.0);
      float cthr = mix(0.6, 0.36, uCloud);
      light = mix(light, shadowTint, smoothstep(cthr, cthr + 0.06, cs) * uCloudShade * 0.7);
    }

    // soft contact shadow where surfaces meet (a few depth taps around the pixel)
    float rpx = clamp(14.0 / max(d, 0.5), 1.5, 26.0) * uRes.y / 900.0;
    float occ = 0.0;
    // (the low quality setting, CHEAP, takes half the taps: one ring of four, half-way out)
    #ifdef CHEAP
    const int AO_TAPS = 4;
    #else
    const int AO_TAPS = 8;
    #endif
    float spin = hash21(pp) * 0.785;
    for (int k = 0; k < AO_TAPS; k++) {
      #ifdef CHEAP
      float a = float(k) * 1.571 + spin * 2.0;
      vec2 o = vec2(cos(a), sin(a)) * rpx * 0.75;
      #else
      float a = float(k) * 0.785 + spin;
      vec2 o = vec2(cos(a), sin(a)) * rpx * (0.5 + 0.5 * float(k / 4));
      #endif
      float dk = linDepth(texture2D(tDepth, vUv + o * px).x);
      float diff = d - dk;
      occ += smoothstep(0.03, 0.4, diff) * (1.0 - smoothstep(0.8, 2.5, diff));
    }
    float ao = 1.0 - (occ / float(AO_TAPS)) * 0.45;

    vec3 painted = base * light * ao;
    // at night the lit windows shine on the walls and the street round them: warm lamplight,
    // falling off within a few strides, and only where the street has its colour back
    if (uNight > 0.01 && sat > 0.01) {
      float lampLight = 0.0;
      for (int i = 0; i < ${LAMP_COUNT}; i++) {
        vec4 lampAt = uLamps[i];
        if (lampAt.w <= 0.0) continue;
        vec3 to = lampAt.xyz - wpos;
        float dd = dot(to, to);
        float fall = max(0.0, 1.0 - dd / ${(LAMP_REACH * LAMP_REACH).toFixed(1)});
        // (wrapped: a wall beside the window warms though it faces along the light)
        lampLight += lampAt.w * fall * fall * max(0.0, dot(wn, to * inversesqrt(dd + 0.01)) * 0.6 + 0.4);
      }
      painted += base * vec3(1.0, 0.6, 0.28) * min(lampLight, 1.6) * 0.85 * uNight * sat * ao;
    }
    // weathering: dirt and moss gather where surfaces meet (the contact shadow finds them):
    // at the foot of a wall, under the eaves, in corners and joints
    if (!figure && !petal && !ground && !grassBlade && !crown && !fish) {
      float grime = smoothstep(0.93, 0.62, ao) * (0.7 + 0.6 * (big - 0.5));
      painted = mix(painted, painted * vec3(0.7, 0.74, 0.58), grime * (timber ? 0.25 : 0.65));
    }
    if (petal) {
      // Dense colour at the throat, a thin irregular wash at the lip. Let skylight fill
      // the folds so turning over a petal doesn't produce a solid black underside.
      vec2 paper = vec2(wpos.x + 0.43 * wpos.z, wpos.y - 0.73 * wpos.z);
      float bleed = (vnoise(paper * 52.0) - 0.5) * (1.0 - smoothstep(2.0, 6.0, d));
      float wash = clamp(petalWash + 0.10 * bleed, 0.0, 1.0);
      vec3 pigment = mix(base * vec3(0.52, 0.42, 0.59), base, smoothstep(0.05, 0.61, wash));
      pigment = mix(pigment, vec3(1.0, 0.88, 0.77), 0.37 * smoothstep(0.47, 0.93, wash));
      vec3 paperLight = mix(shadowTint, uSunColor, smoothstep(-0.68, 0.88, ndl));
      painted = pigment * mix(light, paperLight, 0.74) * mix(ao, 1.0, 0.28);
    }
    if (crown) {
      float fleck = smoothstep(0.01, 0.26, dab) * dabFade;
      painted *= mix(vec3(0.84, 0.95, 1.14), vec3(1.07, 1.02, 0.91), lit);
      painted *= 1.0 + dab * 0.85 * dabFade + canopyWash * 0.6;
      painted += vec3(0.18, 0.19, 0.11) * fleck * light * ao;
    }
    // sunlit leaves catch bright yellow-green highlights
    painted += tex * lit * smoothstep(0.52, 0.75, leaf) * vec3(0.1, 0.11, 0.01) * near;
    // looking towards the sun, light shines through leaves, brightest at a crown's edges
    float edgeOn = 1.0 - abs(dot(wn, -rd));
    painted += tex * pow(max(0.0, dot(rd, uSun)), 3.0) * (0.4 + 0.6 * edgeOn) * vec3(0.2, 0.24, 0.05) * (1.0 - uNight) * near;
    col = mix(drainedAt(painted), painted, sat);
    if (puddle > 0.0) col = mix(col, skyPaint(reflect(rd, vec3(0.0, 1.0, 0.0))) * 0.85, puddle * 0.6);
    // the ink: no paint, a wet sheen where the light catches it
    float solid = figure ? 0.0 : solidOf(s.g) * sat;
    vec3 wet = mix(paletteColor(s.g), vec3(0.36, 0.37, 0.44), pow(clamp(ndl, 0.0, 1.0), 6.0) * 0.55);
    // (and along its edges, seen against the light: the line that draws an ink monster's shape,
    // which a dark outline could not)
    wet += vec3(0.22, 0.27, 0.4) * pow(1.0 - abs(dot(wn, -rd)), 3.0) * 0.7 * mix(0.35, 1.0, lit);
    col = mix(col, wet, solid * 0.97);
    // A person's outline: a thin warm-brown line round the figure and wherever one part of it
    // stands in front of another or turns sharply away, as an animator inks a cel. It is drawn
    // on the figure's own edge pixels, so the silhouette keeps its size, and thins out with
    // distance until only the shape is left.
    if (figure) {
      float wide = max(1.0, uRes.y / 900.0) * 1.3 * (1.0 - smoothstep(22.0, 45.0, d));
      if (nearSkin) wide *= 0.6;
      float line = 0.0;
      for (int k = 0; k < 4; k++) {
        vec2 o = (k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0)) * wide * px;
        vec4 beside = texture2D(tScene, vUv + o);
        float besideDepth = linDepth(texture2D(tDepth, vUv + o).x);
        if (beside.b < 3.0 || beside.b > 7.0 || besideDepth - d > 0.05 + 0.02 * d) line = 1.0;
        else line = max(line, smoothstep(0.95, 1.35, distance(vec2(beside.b - 4.0, beside.a), s.ba)));
      }
      col = mix(col, vec3(0.34, 0.23, 0.17) * mix(light, vec3(1.0), 0.3), line * (nearSkin ? 0.45 : 0.72) * min(wide, 1.0));
    }
    // at night, lamps are lit behind some windows of the streets that have their colour back
    // (each window is lit or dark as a whole, and shows its own room: by day only a hint of
    // it behind the glass, at night the whole of it in lamplight, bright enough to glow)
    if (pane) {
      vec2 street = floor(wpos.xz / 40.0);
      float lamp = step(room, ${LIT_ROOMS}.0 - 0.5);
      float which = floor(hash21(street * 2.3 + room * 5.1 + 7.5) * 23.99);
      // the rooms are painted upright; a window shows the middle of one
      vec2 at = vec2(paneAt.x, mix(0.78, 0.24, paneAt.y));
      vec3 inside = texture2D(uInteriors, (vec2(mod(which, 6.0), floor(which / 6.0)) + at) / vec2(6.0, 4.0)).rgb;
      col = mix(col, inside * 0.55, 0.22 * sat * (1.0 - uNight));
      col = mix(col, inside * 1.5 + vec3(0.16, 0.09, 0.02), lamp * uNight * sat * 0.95);
    }

    // Where a place is drained it is a pen drawing: an outline wherever one thing ends against
    // another (a step in depth, a turn of the surface, a change of what it is made of). The
    // lines fade as the colour comes back and thin away with distance.
    if (sat < 0.98 && !grassBlade && !fish && !petal) {
      float wide = max(1.0, uRes.y / 900.0) * 1.1;
      float mine = held.g < 0.0 ? -1.0 : floor(held.g + 0.04);
      bool plain = held.b < 1.5 && held.b > -1.5;
      float line = 0.0;
      for (int k = 0; k < 4; k++) {
        vec2 o = (k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0)) * wide * px;
        vec4 beside = texture2D(tScene, vUv + o);
        float besideDepth = linDepth(texture2D(tDepth, vUv + o).x);
        // (drawn on the nearer side of a step, so a thing is outlined on itself)
        line = max(line, smoothstep(0.04 + 0.03 * d, 0.08 + 0.06 * d, besideDepth - d));
        // (grass blades cross the ground everywhere: they are not outlined against it)
        if (beside.b > 1.5 && beside.b < 3.0) continue;
        float its = beside.g < 0.0 ? -1.0 : floor(beside.g + 0.04);
        if (its != mine && its < ${MAX_COLORS}.0) line = max(line, 0.8);
        if (plain && beside.b < 1.5 && beside.b > -1.5) line = max(line, smoothstep(0.7, 1.1, distance(beside.ba, held.ba)));
      }
      line *= (1.0 - sat) * (1.0 - smoothstep(50.0, 130.0, d));
      col = mix(col, PEN * mix(1.0, 0.45, uNight), line * 0.95);
    }

${waterGLSL}
    // aerial perspective: far things melt into blue-white haze
    vec3 haze = horizonOf(rd);
    haze = mix(drainedAt(haze), haze, skySat);
    // mist and rain thicken it and pull it close
    float airDistance = length(vpos);
    float air = 1.0 - exp(-max(0.0, airDistance - 35.0) * (0.00065 + uFog * 0.012));
    // Beyond the landscape's readable layers, blend its outer edge into the sky.
    air = max(air, smoothstep(${TUNING.world.landscape.hazeStart.toFixed(1)}, ${TUNING.world.landscape.hazeEnd.toFixed(1)}, airDistance));
    col = mix(col, haze, air);
    // a rainbow stands in the rain between here and far hills, not on what is close by
    if (uRainbow > 0.0) col = withRainbow(col, rainbowOf(rd) * vec4(1.0, 1.0, 1.0, uRainbow * smoothstep(60.0, 300.0, d) * skySat));
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
  gl_FragColor = vec4(col, paintAlpha);
}`;

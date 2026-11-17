// The paint pass's shader: one full-screen pass that reads the G-buffer (see ink-material.ts)
// and depth and paints the frame (see renderer.ts for the look). The sky and the water come in
// as chunks from sky-paint.ts and water-paint.ts.
import { MAX_COLORS, PALETTE, color } from '@/content/palette';
import { BANK_HEIGHT, WATER_LEVEL } from '@/world/wilderness/generator';
import { wildernessDrainGLSL } from './ink-material';
import { skyGLSL } from './sky-paint';
import { WAKE_COUNT, riverGLSL, wakeGLSL, waterGLSL } from './water-paint';

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
uniform vec2 uRiverLane;
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
uniform bool uWildWater;
uniform vec4 uWakes[${WAKE_COUNT}];
uniform int uGrass;
uniform int uSand;
uniform int uRock;
uniform int uSnow;
uniform int uCedar;
uniform sampler2D uCanopyBrush;
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
/** A drained colour: a pale grey wash of it, lighter than its plain luminance. */
vec3 drainedOf(vec3 c) { return greyOf(c) * 0.72 + vec3(0.2); }
/** Drained, as the light allows: by day the pale wash; by night the grey stays dark and takes
 * the moonlight's blue, instead of lifting into a flat, muddy grey. */
vec3 drainedAt(vec3 c) {
  vec3 night = greyOf(c) * vec3(0.8, 0.92, 1.25) + vec3(0.012, 0.02, 0.05);
  return mix(drainedOf(c), night, uNight);
}

${skyGLSL}

${wakeGLSL}

void main() {
  vec2 px = 1.0 / uRes;
  vec4 s = texture2D(tScene, vUv);
  float raw = texture2D(tDepth, vUv).x;
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
    vec3 painted = skyPaint(rd);
    vec4 ranges = farRanges(rd);
    painted = mix(painted, ranges.rgb, ranges.w * (1.0 - uNight * 0.5));
    // drained: an overcast grey version of the same sky
    col = mix(drainedAt(painted), painted, skySat);
  } else {
    vec3 wpos = (uInvView * vec4(vpos, 1.0)).xyz;
    // people in cloth carry their normal's x lifted out of range (ink-material.ts CLOTH)
    bool figure = s.b > 3.0;
    if (figure) s.b -= 4.0;
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
    // Overlapping rows of hand-laid tiles. Fade the joints when several tiles
    // cover one pixel so distant roofs read as a single wash without shimmer.
    int pigment = indexOf(s.g);
    if (!petal && (pigment == ${color('clayTile')} || pigment == ${color('slateTile')}) && wn.y > 0.15) {
      float across = abs(wn.x) > abs(wn.z) ? wpos.z : wpos.x;
      vec2 tile = vec2(across * 1.6, wpos.y * 3.4);
      vec2 footprint = fwidth(tile);
      float fade = 1.0 - smoothstep(0.18, 0.65, max(footprint.x, footprint.y));
      tile.y += 0.055 * sin(across * 1.7);
      tile.x += 0.5 * mod(floor(tile.y), 2.0);
      vec2 f = fract(tile);
      vec2 joints = 1.0 - smoothstep(vec2(0.02), vec2(0.06) + footprint, min(f, 1.0-f));
      float wash = hash21(floor(tile)) - 0.5;
      base *= 1.0 + fade * (0.11 * wash + 0.06 * sin(6.283 * f.x) - 0.21 * joints.y - 0.10 * joints.x);
    }
    bool cedar = indexOf(s.g) == uCedar;
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
    // A coloured wall is a wash over plaster, not a flat block: long strokes run down it,
    // the plaster shows through where the wash is thin, and the colour is a little softer.
    // Far off it settles into one colour again.
    if (!figure && !petal && !ground && !grassBlade && pigment < ${PAINTABLE_COUNT} && an.y < 0.6) {
      float across = an.x > an.z ? wpos.z : wpos.x;
      float streak = vnoise(vec2(across * 4.5, wpos.y * 0.6)) * 0.6 + vnoise(vec2(across * 11.0, wpos.y * 1.4)) * 0.4;
      float wallNear = near * (1.0 - smoothstep(45.0, 130.0, d));
      float thin = smoothstep(0.5, 0.78, big + (leaf - 0.5) * 0.4 + (streak - 0.5) * 0.25);
      base = mix(base, paletteColor(${color('limewash')}.0), 0.42 * thin * wallNear);
      base *= 1.0 + (streak - 0.5) * 0.28 * wallNear;
      base = mix(vec3(dot(base, vec3(0.3, 0.59, 0.11))), base, 0.8);
    }
    // Bark in long broken strokes up the trunk, cooler and a little mossy in the furrows
    if (!figure && pigment == ${color('bark')} && an.y < 0.7) {
      float across = an.x > an.z ? wpos.z : wpos.x;
      float furrow = vnoise(vec2(across * 9.0, wpos.y * 0.9)) * 0.65 + vnoise(vec2(across * 23.0, wpos.y * 2.1)) * 0.35;
      base *= 1.0 + (furrow - 0.5) * 0.4 * near;
      base = mix(base, base * vec3(0.82, 0.98, 0.86), smoothstep(0.55, 0.3, furrow) * 0.6 * near);
    }
    // Paved streets and squares: hand-laid stones in staggered rows, showing in patches and
    // worn smooth between them, gone into one wash where they would be under a pixel.
    if (!figure && !petal && pigment == ${color('stone')} && wn.y > 0.8) {
      // rows of different depths, stones of different lengths in each
      vec2 q = wpos.xz * vec2(1.05, 1.45);
      float row = floor(q.y);
      q.x = q.x * (0.75 + 0.5 * hash21(vec2(row, 3.1))) + hash21(vec2(row, 7.7)) * 4.0;
      q.y += 0.08 * sin(q.x * 1.7);
      vec2 footprint = fwidth(q);
      float paving = (1.0 - smoothstep(0.1, 0.4, max(footprint.x, footprint.y)))
        * smoothstep(0.42, 0.72, big + (leaf - 0.5) * 0.7);
      vec2 f = fract(q);
      vec2 joints = 1.0 - smoothstep(vec2(0.02), vec2(0.13) + footprint, min(f, 1.0 - f));
      float stoneWash = hash21(floor(q)) - 0.5;
      base *= 1.0 + paving * (0.1 * stoneWash - 0.09 * max(joints.x, joints.y));
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
    // rain darkens what faces the sky; on paving and bare earth it pools in puddles that
    // mirror the sky (drawn in once the light is worked out)
    float puddle = 0.0;
    if (!fish && uWet > 0.0 && indexOf(s.g) != uWater && indexOf(s.g) != uGlass) {
      float soaked = uWet * smoothstep(0.3, 0.8, wn.y) * (1.0 - cover);
      base *= 1.0 - 0.24 * soaked;
      float bare = ground ? 1.0 - meadow : (seasonKindOf(s.g) < 0.5 ? 1.0 : 0.0);
      if (!petal) puddle = bare * soaked * smoothstep(0.96, 0.99, wn.y) * smoothstep(0.55, 0.65, big + (leaf - 0.5) * 0.15) * near;
    }
    float mott = ((big - 0.5) * 0.3 + (leaf - 0.5) * 0.35) * tex + (stroke - 0.5) * 0.06;
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
        vec3 brush = texture2D(uCanopyBrush, bp * 0.41 + big * 0.12).rgb;
        vec3 sideBrush = texture2D(uCanopyBrush, vec2(wpos.z - 0.45 * wpos.x, wpos.y + 0.65 * wpos.x) * 0.41).rgb;
        brush = mix(sideBrush, brush, smoothstep(0.25, 0.75, abs(dot(wn, vec3(-0.39, 0.48, 0.78)))));
        dab = (cedar ? brush.g : brush.r) - 0.45;
        canopyWash = (brush.b - 0.46) * dabFade;
      } else dab = dabs(bp * 1.7);
    }
    base *= 1.0 + dab * 0.16 * dabFade;
    // big fields of colour across meadows and hills: warm yellow-green here, cool blue-green there
    float field = fbm2(wpos.xz * 0.011 + 3.0);
    vec3 warm = base * vec3(1.12, 1.07, 0.8);
    vec3 cool = base * vec3(0.88, 0.99, 1.06);
    base = mix(base, mix(cool, warm, smoothstep(0.32, 0.68, field)), tex * near);
    // sunlit dapples in foliage turn yellow-green
    base = mix(base, base * vec3(1.18, 1.14, 0.78), tex * smoothstep(0.55, 0.75, leaf) * 0.55 * near);

    // light: sun with a soft, slightly broken terminator; shadow takes the sky's cool blue
    float ndl = s.r * 2.0 - 1.0;
    // each dab catches the light a little differently, so a crown reads as many clumps
    float lit = smoothstep(-0.12, 0.38, ndl + (leaf - 0.5) * 0.25 * tex + dab * 0.55 * dabFade);
    if (fish) {
      base = fishPaint;
      lit = mix(0.25, 0.90, smoothstep(-0.85, 0.90, ndl));
    }
    vec3 shadowTint = uShade * mix(0.9, 1.08, 0.5 + 0.5 * wn.y);
    // leaves and grass go deeper and bluer in shade
    shadowTint = mix(shadowTint, uShade * vec3(0.76, 0.88, 0.8), tex * 0.6);
    vec3 light = mix(shadowTint, uSunColor, lit);
    // on a broken-cloud day the clouds' shadows sail across the land with the wind
    if (uCloudShade > 0.0) {
      float cs = fbm2((wpos.xz - uDrift) * 0.006 + 11.0);
      float cthr = mix(0.6, 0.36, uCloud);
      light = mix(light, shadowTint, smoothstep(cthr, cthr + 0.06, cs) * uCloudShade * 0.7);
    }

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
    float solid = solidOf(s.g) * sat;
    vec3 wet = mix(paletteColor(s.g), vec3(0.36, 0.37, 0.44), pow(clamp(ndl, 0.0, 1.0), 6.0) * 0.55);
    col = mix(col, wet, solid * 0.97);
    // at night, lamps are lit behind some windows of the streets that have their colour back
    if (indexOf(s.g) == uGlass) {
      float on = step(0.4, hash21(floor(wpos.xz * 0.45) + floor(wpos.y / 3.2) * 7.3));
      col = mix(col, vec3(1.0, 0.76, 0.4), on * uNight * sat * 0.92);
    }

${waterGLSL}
    // aerial perspective: far things melt into blue-white haze
    vec3 haze = horizonOf(rd);
    haze = mix(drainedAt(haze), haze, skySat);
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
  gl_FragColor = vec4(col, paintAlpha);
}`;

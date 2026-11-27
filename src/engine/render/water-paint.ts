// Water in the paint pass (paint-shader.ts): the rivers' current, read from a small table
// around the player, the rings a swimmer or a fish leaves, and the surface itself: the sky
// and whatever stands on the far bank mirrored in slow ripples that drift downstream, glints,
// the sun's web of light on the bed in the shallows, and foam along the shore.
import * as THREE from 'three';
import { MAX_COLORS } from '@/content/palette';
import { CURRENT_STEP } from '@/world/wilderness/water-current';
import { WATER_LEVEL } from '@/world/wilderness/water-level';
import { BANK_CREST_PHASE, BANK_LAP_RATE } from '@/world/wilderness/water-waves';

export const RIVER_SAMPLES = 129;
const FLOW_CYCLE = 3.2;

/** The current's functions: riverFlow and currentRipple. */
export const riverGLSL = /* glsl */ `
/** The surface velocity in xy, and the blend between still and flowing ripples in z. */
vec3 riverFlow(vec2 p) {
  vec2 cell = (p - uRiverGrid.xy) / uRiverGrid.z;
  vec2 edge = min(cell, vec2(uRiverGrid.w - 1.0) - cell);
  float margin = min(edge.x, edge.y);
  if (!uWildWater || margin <= 0.0) return vec3(0.0);
  vec2 velocity = texture2D(uRivers, (cell + 0.5) / uRiverGrid.w).rg * smoothstep(0.0, 8.0, margin);
  return vec3(velocity, smoothstep(0.018, 0.46, length(velocity)));
}
/** Short crests cross the channel and advect along it. Foam breaks into separate patches. */
vec2 currentRipple(vec2 q) {
  float bend = vnoise(q * vec2(0.45, 0.31));
  float ripple = vnoise(vec2(q.x * 0.46, q.y * 1.4 + bend * 0.7));
  float detail = vnoise(q * vec2(1.45, 2.5) + 15.7);
  float whitecap = smoothstep(0.56, 0.76, ripple) * smoothstep(0.27, 0.62, bend * 0.55 + detail * 0.45);
  return vec2(mix(ripple, detail, 0.28), whitecap);
}
// Foam stretches into wider, slower wisps as it drifts downstream.
float capTrail(vec2 q) {
  float curl = vnoise(q * vec2(0.64, 0.33)) - 0.5;
  vec2 samplePos = vec2(q.x * 0.86 + curl, q.y * 1.5 - 0.55);
  float wisps = vnoise(samplePos);
  float gaps = vnoise(samplePos * 2.2 + 18.4);
  return smoothstep(0.56, 0.79, wisps) * smoothstep(0.30, 0.66, gaps);
}
// Short detached surface streaks, spaced apart so the eye can track their movement.
float currentStreak(vec2 q) {
  float lane = vnoise(q * vec2(1.22, 0.19));
  float gap = vnoise(q * vec2(0.46, 0.82) + 23.7);
  return smoothstep(0.55, 0.78, lane) * smoothstep(0.38, 0.69, gap);
}
float bankPhase(vec2 p) {
  return fract(uTime * ${BANK_LAP_RATE} + 0.22 * sin(dot(p, vec2(0.48, 0.31))) +
    0.15 * sin(dot(p, vec2(-0.27, 0.64))) + 0.12 * sin(dot(p, vec2(0.93, -0.76))));
}
// A narrow boundary between the two nearest Voronoi cells becomes the last foam threads.
float foamThreads(vec2 p, float age) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 nearest = vec2(9.0);
  for (int y=-1; y<=1; y++) {
    for (int x=-1; x<=1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 d = offset + hash22(cell + offset) - f;
      float distance2 = dot(d, d);
      if (distance2 < nearest.x) nearest = vec2(distance2, nearest.x);
      else nearest.y = min(nearest.y, distance2);
    }
  }
  float edge = nearest.y - nearest.x;
  return 1.0 - smoothstep(mix(0.65, 0.048, age), mix(0.92, 0.11, age), edge);
}`;

/** What the water throws back and what the sun throws through it: bankPaint, a quick painting
 * of something seen in the water's mirror, and sunWeb, the web of light on a shallow bed. */
export const mirrorGLSL = /* glsl */ `
/** The colour of what the G-buffer holds at one pixel, painted quickly (its pigment in the
 * season's colour, in sun or in shade): enough for a reflection broken up by ripples. */
vec3 bankPaint(vec4 g, vec3 at) {
  float code = g.g < 0.0 ? float(uGrass) : g.g;
  if (code >= ${MAX_COLORS}.0) code = mod(floor(code), ${MAX_COLORS}.0) + 0.9;
  vec3 pigment = seasonal(paletteColor(code), seasonKindOf(code), at.xz);
  float inSun = smoothstep(0.0, 0.15, g.r * 2.0 - 1.0);
  vec3 c = pigment * mix(uShade * vec3(0.8, 0.8, 0.95), uSunColor, inSun);
  return mix(drainedAt(c), c, g.g < 0.0 ? derivedSat(at) * uSceneSat : satOf(code));
}
/** The sun's light gathered by the ripples into a moving web on what lies under shallow water:
 * two webs sliding across each other, brightest where their threads cross. */
float sunWeb(vec2 p) {
  vec2 a = p * 3.1 + vec2(uTime * 0.21, uTime * 0.13);
  vec2 b = p * 2.3 + vec2(-uTime * 0.17, uTime * 0.23) + 9.3;
  float wa = 1.0 - smoothstep(0.0, 0.07, abs(vnoise(a + (vnoise(b * 0.7) - 0.5) * 0.8) - 0.5));
  float wb = 1.0 - smoothstep(0.0, 0.07, abs(vnoise(b) - 0.5));
  return max(wa, wb) * 0.6 + wa * wb * 0.9;
}`;

export const wakeGLSL = /* glsl */ `
vec2 wakeAt(vec2 surface) {
  vec2 uv = (surface - uWakeBounds.xy) / uWakeBounds.z;
  if (!uHasWakes || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec2(0.0);
  vec2 edge = min(uv, 1.0 - uv);
  return texture2D(uWakeField, uv).rg * smoothstep(0.0, 0.06, min(edge.x, edge.y));
}`;

/** The water's surface, inlined into the paint pass's main(): it works on that pass's locals
 * (s, wpos, rd, col, light, lit, sat, fish) and changes col. */
/** Metres from the eye within which a figure is the swimmer's own arms (see swim-arms.ts). */
export const OWN_ARMS = 1.2;

/** Overlapping circular wave packets, as in Unity's RainRipples. Their radial slopes perturb
 * the reflection normal; a separate crest mask keeps the rings visible under overcast skies. */
export const rainRingsGLSL = /* glsl */ `
vec3 rainRings(vec2 p, vec2 current, float density) {
  const float cellSize = 0.9;
  const float waveNumber = 46.0;
  const float windowRate = 3.14159265 / 0.34;
  vec2 cell = floor(p / cellSize);
  vec2 drift = current * (0.12 / max(1.0, length(current) * 0.5));
  vec2 slope = vec2(0.0);
  float crests = 0.0;
  // The maximum radius plus drift is smaller than one cell. Include neighbors so rings
  // cross cell boundaries instead of getting cut off.
  for (int z = -1; z <= 1; z++) {
    for (int x = -1; x <= 1; x++) {
      vec2 id = cell + vec2(float(x), float(z));
      vec2 seed = hash22(id);
      float period = mix(1.3, 2.1, seed.x);
      float phase = uTime / period + seed.y;
      float age = fract(phase) * period;
      if (age >= 1.1) continue;
      vec2 event = id + floor(phase) * vec2(1.73, 2.41);
      float drop = 1.0 - smoothstep(density - 0.1, density, hash21(event + 7.8));
      if (drop <= 0.0) continue;
      vec2 center = (id + mix(vec2(0.1), vec2(0.9), hash22(event + 4.0))) * cellSize;
      vec2 delta = p - center - drift * age;
      float r = length(delta);
      float edge = r - age * mix(0.32, 0.5, seed.y);
      if (edge < -0.27 || edge > 0.07) continue;
      float windowPhase = (edge + 0.27) * windowRate;
      float window = sin(windowPhase);
      float carrier = edge * waveNumber;
      float fade = drop * smoothstep(0.01, 0.14, age) * (1.0 - smoothstep(0.38, 1.1, age));
      // Differentiate the windowed sine along the radius to get the surface slope.
      float waveSlope = cos(carrier) * window * window + (2.0 * windowRate / waveNumber) * sin(carrier) * window * cos(windowPhase);
      slope -= (delta / max(r, 0.03)) * waveSlope * fade;
      crests += max(0.0, sin(carrier)) * window * window * fade;
    }
  }
  return vec3(clamp(slope, -1.0, 1.0), min(1.0, crests));
}`;

export const waterGLSL = /* glsl */ `
    vec3 eye = uInvView[3].xyz;
    float meanDepth = ${WATER_LEVEL} - wpos.y;
    float bankRange = 0.0;
    float bankStrength = 0.0;
    float lapPhase = 0.0;
    float runup = 0.0;
    if (uWildWater && (ground || boulder) && !figure && !fish && abs(meanDepth) < 0.58 &&
        d < 110.0 && eye.y > ${WATER_LEVEL}) {
      float bankSpeed = length(riverFlow(wpos.xz).xy);
      // The last shallow pixels can fall between current samples. Look just downslope.
      float bankSlope = length(wn.xz);
      if (bankSpeed < 0.24 && bankSlope > 0.04) {
        vec2 downslope = wn.xz / bankSlope;
        float nearbySpeed = length(riverFlow(wpos.xz + downslope * 2.3).xy);
        bankSpeed = max(bankSpeed, nearbySpeed * smoothstep(0.04, 0.18, bankSlope) * 0.64);
      }
      bankStrength = smoothstep(0.025, 0.24, bankSpeed);
      bankRange = (1.0 - smoothstep(72.0, 110.0, d)) * smoothstep(0.0, 0.5, eye.y - ${WATER_LEVEL});
      float bankNoise = vnoise(wpos.xz * 0.46);
      float shortWave = sin(dot(wpos.xz, vec2(1.37, -1.04)) + uTime * 5.5 + bankNoise * 3.0);
      lapPhase = bankPhase(wpos.xz);
      float angle = (lapPhase - ${BANK_CREST_PHASE}) * 6.2831853;
      float crest = (cos(angle) + 0.25 * cos(2.0 * angle) + 0.20 * shortWave * bankStrength) / 1.45;
      float reach = 0.03 + 0.17 * bankStrength + 0.13 * smoothstep(0.24, 0.95, bankSpeed);
      runup = reach * mix(0.65, 1.0, bankNoise) * bankRange;
      // Wetness follows the reach and timing of the last crest, on both sides of the mean level.
      float wetReach = 1.0 - smoothstep(runup * 0.42, runup + 0.001, -meanDepth);
      float age = fract(lapPhase - 0.61);
      float wetness = wetReach * smoothstep(0.0, 0.14, age) * (1.0 - smoothstep(0.28, 0.98, age));
      wetness *= bankStrength * bankRange * (1.0 - smoothstep(0.06, 0.35, meanDepth));
      float sheen = pow(max(0.0, dot(reflect(rd, vec3(0.0, 1.0, 0.0)), uSun)), 36.0);
      col = col * (1.0 - wetness * 0.23) + uSunColor * sheen * wetness * 0.17 * (1.0 - uNight);
      runup *= crest * (1.0 - smoothstep(0.26, 0.58, abs(meanDepth)));
    }
    // The rendered waterline moves where this wave height intersects the terrain.
    float waterDepth = meanDepth + runup;
    bool submerged = uWildWater && waterDepth > 0.0;
    if (indexOf(s.g) == uWater || submerged) {
      // water mirrors the painted sky, more so at a glancing angle; slow ripple bands drift
      // across it and the sun glints off their crests
      float surfaceY = submerged ? ${WATER_LEVEL} + runup : wpos.y;
      float t = clamp((eye.y - surfaceY) / max(0.001, eye.y - wpos.y), 0.0, 1.0);
      vec2 rp = submerged ? mix(eye.xz, wpos.xz, t) : wpos.xz;
      // still water ripples in place; in a river the ripples stretch along the current and are
      // carried downstream: two copies drifting half a cycle apart, each faded out as it
      // starts over (the two-phase flow technique)
      float still = vnoise(rp * 0.65 + vec2(uTime * 0.06, 0.0)) * 0.6 + vnoise(rp * 2.3 - uTime * 0.09) * 0.4;
      vec3 flow = riverFlow(rp);
      float speed = length(flow.xy);
      float rapids = smoothstep(0.68, 2.3, speed);
      vec2 along = speed > 0.001 ? flow.xy / speed : vec2(0.0, 1.0);
      vec2 across = vec2(along.y, -along.x);
      float ph0 = fract(uTime / ${FLOW_CYCLE.toFixed(1)} + vnoise(rp * 0.075) * 0.45);
      float ph1 = fract(ph0 + 0.5);
      float swap = abs(ph0 - 0.5) * 2.0;
      vec2 drift0 = flow.xy * ph0 * ${FLOW_CYCLE.toFixed(1)};
      vec2 drift1 = flow.xy * ph1 * ${FLOW_CYCLE.toFixed(1)};
      // Keep the noise in world space so turns in the current do not tear its phase.
      vec2 p0 = rp - drift0;
      vec2 p1 = rp - drift1 + 19.2;
      vec2 flowing = vec2(still, 0.0);
      float streak = 0.0;
      float foamTrail = 0.0;
      if (flow.z > 0.0) {
        // Both phases share the distortion, so rolling over cannot jump the foam.
        vec2 warp = (vec2(vnoise(rp * 0.91 - flow.xy * sin(uTime * 0.5) * 0.4),
          vnoise(rp * 0.85 + across * cos(uTime * 0.61) + 12.6)) - 0.5) * 0.66;
        p0 += warp;
        p1 += warp;
        float orientation = smoothstep(0.35, 0.88, abs(along.x));
        if (orientation < 1.0) {
          flowing = mix(currentRipple(p0), currentRipple(p1), swap);
          streak = mix(currentStreak(p0), currentStreak(p1), swap);
        }
        if (orientation > 0.0) {
          flowing = mix(flowing, mix(currentRipple(p0.yx), currentRipple(p1.yx), swap), orientation);
          streak = mix(streak, mix(currentStreak(p0.yx), currentStreak(p1.yx), swap), orientation);
        }
        if (rapids > 0.0 && waterDepth > 0.01 && eye.y > surfaceY && !fish && !figure && d < 130.0) {
          vec2 trail0 = p0 + drift0 * 0.22;
          vec2 trail1 = p1 + drift1 * 0.22;
          if (orientation < 1.0) foamTrail = mix(capTrail(trail0), capTrail(trail1), swap);
          if (orientation > 0.0)
            foamTrail = mix(foamTrail, mix(capTrail(trail0.yx), capTrail(trail1.yx), swap), orientation);
        }
        // A finer layer slips downstream faster with a little cross-stream shear.
        vec2 shear = across * 0.31;
        float lace = mix(vnoise((p0 - (drift0 * 0.35 + shear * ph0)) * 4.7),
                         vnoise((p1 - (drift1 * 0.35 + shear * ph1)) * 4.7), swap);
        flowing.y *= mix(0.52, 1.0, smoothstep(0.28, 0.76, lace));
      }
      float rip = mix(still, flowing.x, flow.z);
      vec2 wakes = submerged ? wakeAt(rp) : vec2(0.0);
      vec3 rainRipples = vec3(0.0);
      if (uRainfall > 0.01 && eye.y > surfaceY && !fish) {
        float range = 1.0 - smoothstep(9.0, 30.0, length(vec3(rp - eye.xz, surfaceY - eye.y)));
        if (range > 0.0) {
          float strength = smoothstep(0.01, 0.28, uRainfall) * range;
          rainRipples = rainRings(rp, flow.xy * flow.z, mix(0.25, 0.98, uRainfall)) * strength;
        }
      }
      vec2 slopeDir = mix(vec2(0.6, 0.48), along + across * 0.23, flow.z);
      vec2 surfaceSlope = (rip - 0.5) * slopeDir * mix(0.085, 0.21, rapids) + rainRipples.xy * 0.14;
      surfaceSlope += (wakes.x - wakes.y) * vec2(0.05, -0.08);
      vec3 rdir = reflect(rd, normalize(vec3(surfaceSlope.x, 1.0, surfaceSlope.y)));
      float grazing = 1.0 - clamp(-rd.y, 0.0, 1.0);
      vec3 reflected = skyPaint(rdir);
      // What stands on the bank is mirrored too: follow the reflected ray out over the water
      // in lengthening strides, and where it passes behind something the frame holds above
      // the waterline, paint that. (Only what is on screen can be mirrored; the rest is sky.)
      if (!fish && rdir.y > 0.01) {
        vec3 from = vec3(rp.x, surfaceY, rp.y);
        float stride = 0.5;
        float gone = 0.0;
        for (int k = 0; k < 14; k++) {
          gone += stride;
          stride *= 1.5;
          vec4 clip = uViewProj * vec4(from + rdir * gone, 1.0);
          if (clip.w <= 0.0) break;
          vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
          if (suv.x <= 0.0 || suv.x >= 1.0 || suv.y <= 0.0 || suv.y >= 1.0) break;
          float raw2 = texture2D(tDepth, suv).x;
          if (uReversedDepth > 0.5 ? raw2 <= 0.0 : raw2 >= 0.99999) continue;
          float d2 = linDepth(raw2);
          if (d2 > clip.w - 0.05 || d2 < clip.w - (1.5 + 0.6 * gone)) continue;
          vec4 c2 = uInvProj * vec4(suv * 2.0 - 1.0, -1.0, 1.0);
          vec3 ray2 = c2.xyz / c2.w;
          vec3 at2 = (uInvView * vec4(ray2 * (d2 / -ray2.z), 1.0)).xyz;
          if (at2.y < surfaceY + 0.05) continue;
          vec2 rim = min(suv, 1.0 - suv);
          vec3 bank = bankPaint(texture2D(tScene, suv), at2);
          // paler with distance, like everything far off
          bank = mix(bank, horizonOf(rdir), 1.0 - exp(-(d + gone) * 0.00065));
          reflected = mix(reflected, bank, smoothstep(0.0, 0.06, min(rim.x, rim.y)) * 0.85);
          break;
        }
      }
      vec3 water;
      float opacity;
      if (fish) {
        // Looking down, the reflection belongs to the lake surface, independent
        // of the fish's orientation. Below the surface only the water tint remains.
        float surface = smoothstep(-0.02, 0.06, eye.y - ${WATER_LEVEL});
        vec3 tint = paletteColor(float(uWater)) * mix(uShade, uSunColor, 0.62);
        water = mix(tint, reflected, surface * (0.12 + 0.60 * grazing * grazing));
        opacity = mix(0.16, 0.37, smoothstep(0.2, 1.4, waterDepth)) + surface * grazing * 0.16;
      } else {
        float fres = 0.2 + 0.7 * pow(grazing, 4.0);
        float clear = exp(-max(0.0, waterDepth) * 0.82);
        vec3 tint = paletteColor(float(uWater)) * light * mix(vec3(0.47, 0.74, 0.84), vec3(1.0), clear);
        water = mix(tint, reflected, fres * mix(0.68, 1.0, clear));
        water += vec3(0.92, 0.96, 1.0) * smoothstep(0.76, 0.85, rip) * 0.09 * lit * (1.0 - uNight);
        float glint = pow(max(0.0, dot(rdir, uSun)), 120.0) * smoothstep(0.52, 0.75, rip);
        water += uSunColor * glint * mix(0.42, 0.86, rapids) * (1.0 - uNight);
        float rippleShade = clamp(dot(rainRipples.xy, vec2(0.09, -0.07)), -0.1, 0.1);
        water *= 1.0 + rippleShade;
        water = mix(water, vec3(0.82, 0.9, 0.98) * mix(light, vec3(1.0), 0.45), rainRipples.z * 0.42);
        opacity = submerged ? smoothstep(0.0, 0.15, waterDepth) * mix(0.94, 0.27, clear) : 1.0;
        // seen at a glancing angle even shallow water is a mirror: the bed shows only when
        // one looks down into it
        // (only partly: a river seen from its bank is nearly all at a glancing angle, and a
        // full mirror there shows the pale horizon and nothing of the water's own colour)
        if (submerged) opacity = max(opacity, smoothstep(0.0, 0.12, waterDepth) * pow(grazing, 5.0) * 0.5);
        // A thin sheet still reads as water when seen from above, even over sand.
        float wash = bankRange * (1.0 - smoothstep(0.18, 0.45, abs(meanDepth)));
        opacity = max(opacity, wash * smoothstep(0.0, 0.055, waterDepth) * mix(0.20, 0.55, bankStrength));
        // the swimmer's own arms lie only just under the surface, yet should read as under it
        if (figure && d < ${OWN_ARMS.toFixed(1)}) opacity = max(opacity, 0.4 * smoothstep(0.0, 0.015, waterDepth));
      }
      // the sun's web of light on the bed, where the water is shallow enough to see it
      if (submerged && !fish) {
        float shallow = smoothstep(0.03, 0.25, waterDepth) * (1.0 - smoothstep(0.7, 2.2, waterDepth));
        // (a close thing: from across the river the web is finer than a brush could draw)
        shallow *= 1.0 - smoothstep(7.0, 24.0, d);
        col += col * uSunColor * sunWeb(wpos.xz) * shallow * lit * 0.3 * (1.0 - uNight) * (1.0 - uOvercast);
      }
      if (!fish || eye.y > ${WATER_LEVEL})
        water += (vec3(0.45, 0.58, 0.5) * wakes.x - vec3(0.12, 0.16, 0.15) * wakes.y) * mix(0.4, 1.0, lit);
      col = mix(col, mix(drainedAt(water), water, sat), opacity);
      // Composite the moving surface detail over the bed, where transparency would hide it.
      if (!fish && !figure && eye.y > surfaceY && flow.z > 0.0) {
        float detail = flow.z * smoothstep(0.01, 0.18, waterDepth) * (1.0 - smoothstep(58.0, 130.0, d));
        vec3 crest = mix(vec3(0.60, 0.77, 0.79), vec3(0.89, 0.97, 0.99), rapids);
        crest *= mix(light, vec3(1.0), 0.38) * (1.0 - 0.47 * uNight);
        col *= 1.0 - detail * (1.0 - smoothstep(0.2, 0.46, flowing.x)) * 0.13;
        col = mix(col, mix(drainedAt(crest), crest, sat), detail * streak * mix(0.37, 0.55, rapids));
        float breaker = flowing.y * rapids;
        float foam = foamTrail * rapids;
        if (foam > 0.025 && detail > 0.0 && d < 38.0) {
          float threads = mix(foamThreads(p0 * 5.0, ph0), foamThreads(p1 * 5.0, ph1), swap);
          foam *= mix(0.45, 1.0, threads);
        }
        vec3 whiteWater = vec3(0.92, 0.98, 1.0) * mix(light, vec3(1.0), 0.53) * (1.0 - 0.42 * uNight);
        col = mix(col, mix(drainedAt(whiteWater), whiteWater, sat), detail * min(0.96, breaker * 0.95 + foam * 0.63));
      }
      // Broken foam rides the advancing edge and frays as the water retreats.
      if (submerged && bankRange > 0.0 && bankStrength > 0.0 && eye.y > surfaceY && waterDepth < 0.34) {
        float crest = smoothstep(0.0, 0.026, waterDepth) * (1.0 - smoothstep(0.05, 0.16, waterDepth));
        float wash = smoothstep(0.26, 0.57, lapPhase) * (1.0 - smoothstep(0.76, 0.98, lapPhase));
        float laced = mix(vnoise(p0 * 1.36), vnoise(p1 * 1.36), swap);
        float groups = vnoise(wpos.xz * 0.54);
        float lace = smoothstep(0.23, 0.63, laced * 0.52 + groups * 0.48);
        float retreat = smoothstep(0.67, 0.98, lapPhase);
        float foamDepth = mix(0.065, 0.23, retreat) + (laced - 0.5) * 0.1;
        float backwash = (1.0 - smoothstep(0.02, 0.095, abs(waterDepth - foamDepth))) *
          smoothstep(0.60, 0.77, lapPhase) * (1.0 - smoothstep(0.82, 1.0, lapPhase));
        if (backwash * lace * bankRange * bankStrength > 0.035 && d < 32.0)
          backwash *= foamThreads(wpos.xz * 6.0 + vec2(laced), retreat);
        float foamAmount = min(0.98, crest * wash + backwash * 0.58) * lace * bankRange * bankStrength;
        vec3 foam = vec3(0.95, 0.97, 0.98) * mix(light, vec3(1.0), 0.47);
        col = mix(col, mix(drainedAt(foam), foam, sat), foamAmount * (1.0 - 0.44 * uNight));
      }
    }
    // a thin bright line where each of the swimmer's arms breaks the surface
    if (uWildWater && figure && d < ${OWN_ARMS.toFixed(1)}) {
      float meniscus = 1.0 - smoothstep(0.002, 0.007, abs(waterDepth));
      col = mix(col, vec3(0.94, 0.97, 1.0) * mix(light, vec3(1.0), 0.5), meniscus * 0.45 * (1.0 - 0.6 * uNight));
    }`;

/** The surface velocity field around the player, as a texture for the paint pass. */
export class RiverTable {
  private readonly data = new Uint16Array(RIVER_SAMPLES * RIVER_SAMPLES * 2);
  readonly grid = new THREE.Vector4(0, 0, CURRENT_STEP, RIVER_SAMPLES);
  private published = false;
  private pending: { x: number; z: number; steps: Generator<void, Uint16Array> } | null = null;
  readonly texture = Object.assign(
    new THREE.DataTexture(this.data, RIVER_SAMPLES, RIVER_SAMPLES, THREE.RGFormat, THREE.HalfFloatType),
    { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter },
  );

  /** Keep the last complete field visible while preparing a new one. */
  request(x0: number, z0: number, at: (x: number, z: number) => { x: number; z: number }): void {
    if (this.pending?.x === x0 && this.pending.z === z0) return;
    this.pending?.steps.return(this.data);
    this.pending = null;
    if (this.published && this.grid.x === x0 && this.grid.y === z0) return;
    this.pending = { x: x0, z: z0, steps: this.sample(x0, z0, at) };
  }

  update(budgetMs: number): void {
    const job = this.pending;
    if (!job || budgetMs <= 0) return;
    const until = performance.now() + budgetMs;
    do {
      const next = job.steps.next();
      if (next.done) {
        this.data.set(next.value);
        this.grid.set(job.x, job.z, CURRENT_STEP, RIVER_SAMPLES);
        this.texture.needsUpdate = true;
        this.published = true;
        this.pending = null;
        return;
      }
    } while (performance.now() < until);
  }

  get ready(): boolean {
    return this.pending === null;
  }

  private *sample(
    x0: number,
    z0: number,
    at: (x: number, z: number) => { x: number; z: number },
  ): Generator<void, Uint16Array> {
    const next = new Uint16Array(this.data.length);
    const dx = (x0 - this.grid.x) / CURRENT_STEP;
    const dz = (z0 - this.grid.y) / CURRENT_STEP;
    const reuse = this.published && Number.isInteger(dx) && Number.isInteger(dz);
    for (let row = 0; row < RIVER_SAMPLES; row++) {
      for (let column = 0; column < RIVER_SAMPLES; column++) {
        const i = (row * RIVER_SAMPLES + column) * 2;
        const oldX = column + dx,
          oldZ = row + dz;
        if (reuse && oldX >= 0 && oldX < RIVER_SAMPLES && oldZ >= 0 && oldZ < RIVER_SAMPLES) {
          const old = (oldZ * RIVER_SAMPLES + oldX) * 2;
          next[i] = this.data[old]!;
          next[i + 1] = this.data[old + 1]!;
        } else {
          const v = at(x0 + column * CURRENT_STEP, z0 + row * CURRENT_STEP);
          next[i] = THREE.DataUtils.toHalfFloat(v.x);
          next[i + 1] = THREE.DataUtils.toHalfFloat(v.z);
        }
        if (column % 32 === 31) yield;
      }
      yield;
    }
    return next;
  }

  dispose(): void {
    this.pending?.steps.return(this.data);
    this.pending = null;
    this.texture.dispose();
  }
}

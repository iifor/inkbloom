// The painted sky the paint pass (paint-shader.ts) draws behind everything and mirrors in
// water and puddles: a deep turquoise overhead fading to a pale horizon, towering cumulus
// standing round the horizon (painted clouds from an atlas, see painted-textures.ts) that sail
// with the wind, a grey deck that closes over them in bad weather, stars at night, and far
// mountain ranges along the horizon. A GLSL chunk: it reads the paint pass's sun and sky
// uniforms, its cloud atlas (uClouds) and its noise (hash21, hash22, fbm, fbm2).

export const skyGLSL = /* glsl */ `
/** Sky colour near the horizon, which is also the colour of distant haze. */
vec3 horizonOf(vec3 rd) {
  // warmer towards the sun
  float toward = pow(max(0.0, dot(normalize(rd.xz + 1e-5), normalize(uSun.xz + 1e-5))), 3.0);
  return uHorizon + (uSunColor - vec3(0.9)) * 0.12 * toward * (1.0 - uNight);
}

/**
 * One ring of painted cumulus standing round the horizon. The ring is cut into \`count\` cells
 * and a cell holds one cloud from the atlas (two columns by three rows) or none: \`amount\` is
 * the share of cells that hold one. \`turn\` is the way the ray looks, in turns round the
 * horizon, and \`el\` how high, in radians; a cloud's foot stands about \`base\` radians up.
 * Light follows the sun without changing the cloud's shape. Returns its light in x
 * (grey underneath .. white on top) and its opacity in y.
 */
vec2 cumulusRing(float turn, float el, float count, float base, float seed, float amount, float sunTurn) {
  float x = turn * count;
  float cell = floor(x);
  float id = mod(cell, count);
  float chance = hash21(vec2(seed + 3.1, id * 2.11 + 0.5));
  float presence = smoothstep(chance, chance + 0.09, amount);
  if (presence <= 0.0) return vec2(0.0);
  vec2 h = hash22(vec2(id * 1.37 + 0.5, seed));
  // narrower than its cell and set anywhere inside it, so it never crosses into the next
  float w = 0.7 + 0.3 * h.x;
  float off = (h.y - 0.5) * (1.0 - w);
  float u = (fract(x) - 0.5 - off) / w + 0.5;
  float v = (el - base * (0.75 + 0.5 * h.y)) / (w * 6.2832 / count * 0.667);
  if (u <= 0.0 || u >= 1.0 || v <= 0.0 || v >= 1.0) return vec2(0.0);
  float pick = floor(hash21(vec2(id + 11.0, seed * 1.7)) * 5.999);
  vec2 paint = texture2D(uClouds, vec2((mod(pick, 2.0) + u) * 0.5, (floor(pick * 0.5) + 1.0 - v) / 3.0)).rg;
  // Change the lighting without flipping the silhouette.
  float sunSide = sin((sunTurn - (cell + 0.5 + off) / count) * 6.2832);
  paint.x = clamp(paint.x + sunSide * (u - 0.5) * 0.24, 0.0, 1.0);
  // Fade out before sampling stops at the atlas tile's edge.
  float edge = min(min(u, 1.0 - u), min(v, 1.0 - v));
  return vec2(paint.x, paint.y * presence * smoothstep(0.0, 0.035, edge));
}

/** Painted sky along a world-space ray: a deep turquoise overhead fading to a pale horizon,
 * with big cumulus clouds, white on the sunny side and blue-violet underneath. */
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
  // clouds sail downwind (uDrift: how far the wind has carried the air, metres)
  vec2 cuv = rd.xz / (max(e, 0.0) + 0.3) * 1.0 - uDrift * 0.0015;
  // warp the noise into rounded heaps rather than streaks
  cuv += (vec2(fbm2(cuv * 0.6), fbm2(cuv * 0.6 + 3.1)) - 0.5) * 1.3;
  float n = fbm(cuv);
  float above = smoothstep(-0.01, 0.1, e);
  // the weather's cloud cover fills the gaps until the sky is one grey deck
  // (in fair weather only a few high wisps: the cumulus below are the day's clouds)
  float thr = mix(0.6, 0.52, smoothstep(0.05, 0.55, e)) - uCloud * 0.34 + 0.2 * (1.0 - smoothstep(0.2, 0.6, uCloud));
  // soft edges, like a cloud painted wet into wet
  float body = smoothstep(thr - 0.01, thr + 0.06 + uCloud * 0.06, n) * above;
  // lit where the cloud thins towards the sun, shadowed underneath
  float n2 = fbm(cuv + uSun.xz * 0.09);
  float lit = smoothstep(0.0, 1.0, clamp((n - n2) * 5.0 + 0.55, 0.0, 1.0));
  lit = mix(lit, 1.0, (1.0 - smoothstep(0.0, 0.05, n - thr)) * 0.5);
  // moonlit clouds are a cool blue-grey, not a dimmed white
  vec3 cloudLit = mix(mix(vec3(1.0, 0.99, 0.96), clamp(uSunColor, 0.0, 1.0), 0.35), vec3(0.2, 0.24, 0.36), uNight);
  vec3 cloudShade = mix(uShade, uZenith, 0.3) * vec3(1.2, 1.1, 1.16);
  // rain clouds are heavy and grey, darker underneath
  vec3 rainGrey = vec3(0.6, 0.62, 0.67) * mix(1.0, 0.3, uNight);
  cloudLit = mix(cloudLit, rainGrey, uOvercast * 0.75 + uCloud * 0.15);
  cloudShade = mix(cloudShade, rainGrey * 0.72, uOvercast * 0.8);
  vec3 cloud = mix(cloudShade, cloudLit, lit);
  c += vec3(star * 0.8);
  // The painted cumulus: three rings round the horizon, the far ones small, low and pale with
  // haze, the near ones towering. More of them as the weather clouds over, until the grey deck
  // covers them. They sail round with the wind, the near ones fastest.
  float turn = atan(rd.z, rd.x) / 6.2832;
  float sunTurn = atan(uSun.z, uSun.x) / 6.2832;
  float el = asin(clamp(e, -1.0, 1.0));
  // Normalise the wind projection to turns. The painted rings sit closer than the
  // high cloud layer, so a few seconds of wind should visibly carry their silhouettes.
  float sail = dot(uDrift, vec2(0.35, 0.94)) * 0.00016;
  vec3 haze = horizonOf(rd);
  for (int ring = 0; ring < 3; ring++) {
    float far = 1.0 - float(ring) * 0.5;
    float count = ring == 0 ? 19.0 : ring == 1 ? 11.0 : 6.0;
    float base = ring == 0 ? 0.035 : ring == 1 ? 0.085 : 0.17;
    float amount = (ring == 0 ? 0.62 : ring == 1 ? 0.46 : 0.3) + uCloud * 0.9;
    float moved = fract(sail * (1.0 + float(ring)));
    vec2 k = cumulusRing(turn + moved, el, count, base, 17.0 + 9.0 * float(ring), amount, sunTurn + moved);
    vec3 heap = mix(cloudShade, cloudLit, smoothstep(0.56, 0.9, k.x));
    heap = mix(heap, haze, 0.5 * far);
    c = mix(c, heap, k.y * above);
  }
  return mix(c, cloud, body);
}

/**
 * A rainbow round the point opposite the sun: the primary bow 40–42.5° out, violet inside and
 * red outside, the sky a little brighter within it, and a fainter secondary bow at 50–54° with
 * its colours the other way round. Washed in unevenly, like paint. Returns the bow's colour and,
 * in w, how much of it to lay over the sky.
 */
vec3 bowColour(float t) {
  vec3 c = clamp(abs(fract((1.0 - t) * 0.8 + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(c, vec3(0.85), 0.1);
}
vec4 rainbowOf(vec3 rd) {
  float a = degrees(acos(clamp(dot(rd, -uSun), -1.0, 1.0)));
  if (a < 30.0 || a > 56.0) return vec4(0.0);
  float t1 = (a - 39.8) / 2.8;
  float t2 = (54.2 - a) / 3.8;
  float band1 = smoothstep(0.0, 0.18, t1) * smoothstep(1.0, 0.82, t1);
  float band2 = smoothstep(0.0, 0.18, t2) * smoothstep(1.0, 0.82, t2) * 0.3;
  vec3 c = band1 > band2 ? bowColour(clamp(t1, 0.0, 1.0)) : bowColour(clamp(t2, 0.0, 1.0));
  // the sky is a little brighter inside the bow
  float inside = 0.12 * smoothstep(30.0, 38.0, a) * smoothstep(40.5, 39.0, a);
  // thicker in some stretches of the arc than others, and gone into the ground
  float wash = clamp(0.35 + 0.9 * fbm2(rd.xz * 2.2 + rd.y * 3.0 + 5.0), 0.0, 1.0);
  float body = max(band1, band2) * 0.55 * wash;
  return vec4(mix(vec3(1.0), c, body / max(body + inside, 1e-4)), (body + inside) * smoothstep(-0.03, 0.04, rd.y));
}
/** A rainbow laid over a colour: the bow's own hue, not a pale wash added on top. */
vec3 withRainbow(vec3 c, vec4 bow) {
  return mix(c, c * 0.55 + bow.rgb * 0.62, bow.a);
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
  float h1 = 0.035 + 0.075 * fbm2(dir * 3.0 + 11.0);
  float h2 = 0.012 + 0.05 * fbm2(dir * 5.5 + 29.0);
  float m1 = smoothstep(h1 + 0.002, h1 - 0.002, e);
  float m2 = smoothstep(h2 + 0.002, h2 - 0.002, e);
  // lighter towards their feet, where the haze is thickest
  far = mix(haze, far, smoothstep(-0.02, h1, e) * 0.85 + 0.15);
  near = mix(haze, near, smoothstep(-0.02, h2, e) * 0.8 + 0.2);
  vec3 c = mix(far, near, m2);
  return vec4(c, max(m1, m2));
}`;

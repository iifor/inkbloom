// The painted sky the paint pass (paint-shader.ts) draws behind everything and mirrors in
// water and puddles: a deep turquoise overhead fading to a pale horizon, cumulus clouds that
// sail with the wind, stars at night, and far mountain ranges along the horizon. A GLSL chunk:
// it reads the paint pass's sun and sky uniforms and its noise (hash21, fbm, fbm2).

export const skyGLSL = /* glsl */ `
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
  // clouds sail downwind (uDrift: how far the wind has carried the air, metres)
  vec2 cuv = rd.xz / (max(e, 0.0) + 0.3) * 1.0 - uDrift * 0.0015;
  // warp the noise into rounded heaps rather than streaks
  cuv += (vec2(fbm2(cuv * 0.6), fbm2(cuv * 0.6 + 3.1)) - 0.5) * 1.3;
  float n = fbm(cuv);
  float above = smoothstep(-0.01, 0.1, e);
  // the weather's cloud cover fills the gaps until the sky is one grey deck
  float thr = mix(0.6, 0.52, smoothstep(0.05, 0.55, e)) - uCloud * 0.34;
  // soft edges, like a cloud painted wet into wet
  float body = smoothstep(thr - 0.01, thr + 0.06 + uCloud * 0.06, n) * above;
  // lit where the cloud thins towards the sun, shadowed underneath
  float n2 = fbm(cuv + uSun.xz * 0.09);
  float lit = smoothstep(0.0, 1.0, clamp((n - n2) * 5.0 + 0.55, 0.0, 1.0));
  lit = mix(lit, 1.0, smoothstep(0.05, 0.0, n - thr) * 0.5);
  // moonlit clouds are a cool blue-grey, not a dimmed white
  vec3 cloudLit = mix(mix(vec3(1.0, 0.99, 0.96), clamp(uSunColor, 0.0, 1.0), 0.35), vec3(0.2, 0.24, 0.36), uNight);
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

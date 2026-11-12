// Shader du terrain (WebGL1 / GLSL ES 1.00, compatible Safari iOS).
// Le relief, les masques de rivières/routes/champs sont des textures de données issues de worldgen.
export const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const MAX_LIGHTS = 20;

export const FRAG = `
precision highp float;
uniform vec2 uRes;      // px device
uniform vec2 uCam;      // centre monde
uniform float uScale;   // px device par unité monde
uniform float uTime;
uniform float uWorld;   // taille du monde
uniform float uHS;
uniform float uSea;
uniform vec3 uSun;
uniform float uDetail;  // 0..1 qualité (réduit les échantillons pendant les mouvements)
uniform sampler2D uD0, uD1, uReveal, uGrass, uForest, uRock, uSand, uWater;
uniform vec4 uLA[${MAX_LIGHTS}];  // x,y,rayon,intensité
uniform vec4 uLC[${MAX_LIGHTS}];  // rgb

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1.,0.)), c = hash(i+vec2(0.,1.)), d = hash(i+vec2(1.,1.));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s; }
float fbm2(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<2;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s/0.75; }
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }

vec3 tile(sampler2D t, vec2 w, float scale){
  vec2 p = w / scale;
  vec3 a = texture2D(t, p).rgb;
  vec3 b = texture2D(t, p*0.31 + vec2(0.37,0.11)).rgb;
  return toLin(mix(a, b, 0.42));
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 world = uCam + vec2(fc.x - uRes.x*0.5, uRes.y*0.5 - fc.y) / uScale;
  vec2 uv = world / uWorld;
  float inside = step(0.0, uv.x)*step(uv.x, 1.0)*step(0.0, uv.y)*step(uv.y, 1.0);
  vec2 cuv = clamp(uv, 0.0005, 0.9995);

  vec4 d0 = texture2D(uD0, cuv);
  vec4 d1 = texture2D(uD1, cuv);
  float h = mix(0.05, d0.r, inside);
  float moist = d0.g, ao = d0.b, road = d0.a * inside;
  vec3 n = vec3(d1.xy*2.0-1.0, 0.0);
  n.z = sqrt(max(0.0, 1.0 - dot(n.xy,n.xy)));
  float slope = 1.0 - n.z;
  float river = d1.b * inside, farm = d1.a * inside;

  float nz1 = vnoise(world*0.012);
  float nz2 = fbm2(world*0.0035 + 3.0);

  // ----- eau -----
  float riverM = smoothstep(0.28, 0.58, river + (nz1-0.5)*0.32);
  float seaM = 1.0 - smoothstep(uSea-0.006, uSea+0.002, h + (nz1-0.5)*0.004);
  float waterM = max(riverM, seaM);
  vec2 wv = vec2(uTime*7.0, uTime*3.5);
  vec3 wt = tile(uWater, world + wv, 1400.0)*0.55 + tile(uWater, world*1.7 - wv*1.3 + 100.0, 1400.0)*0.45;

  // ----- terre -----
  vec3 grass = vec3(0.0), forest = vec3(0.0), rock = vec3(0.0), sand = vec3(0.0);
  float rockW = clamp(smoothstep(0.2, 0.46, slope + (nz2-0.5)*0.08) + smoothstep(0.7, 0.86, h + (nz2-0.5)*0.12), 0.0, 1.0);
  float forestW = smoothstep(0.44, 0.58, moist + (nz2-0.5)*0.55) * (1.0-rockW) * (1.0 - smoothstep(0.64, 0.78, h));
  float beachW = (1.0 - smoothstep(uSea+0.006, uSea+0.032, h + (nz1-0.5)*0.01)) * (1.0-seaM);
  float roadW = smoothstep(0.22, 0.62, road + (nz1-0.5)*0.28);
  float grassW = max(0.0, 1.0 - rockW - forestW);
  if (grassW + 0.0 > 0.002) grass = tile(uGrass, world, 820.0);
  if (forestW > 0.002) forest = tile(uForest, world, 760.0);
  if (rockW > 0.002) rock = tile(uRock, world, 980.0);
  if (beachW + roadW > 0.002) sand = tile(uSand, world, 560.0);

  vec3 alb = grass*grassW + forest*forestW + rock*rockW;
  // champs cultivés (damier de parcelles rayées)
  float farmW = smoothstep(0.34, 0.6, farm + (nz2-0.5)*0.7) * (1.0-rockW) * (1.0-forestW*0.6) * (1.0-beachW);
  if (farmW > 0.01) {
    vec2 q = world / 150.0 + vec2(nz2*0.6);
    vec2 id = floor(q), f = fract(q);
    float r1 = hash(id), r2 = hash(id+7.7);
    float ang = r1*6.2831;
    vec2 dir = vec2(cos(ang), sin(ang));
    float stripe = 0.5 + 0.5*sin(dot(world, dir)/5.5);
    vec3 c1 = mix(vec3(0.55,0.47,0.16), vec3(0.34,0.44,0.14), step(0.5,r2));
    vec3 c2 = mix(vec3(0.42,0.34,0.14), vec3(0.62,0.58,0.22), step(0.65,r2));
    vec3 fcol = toLin(mix(c1, c2, stripe*0.7)) * (0.9 + 0.2*r1);
    float hedge = smoothstep(0.0, 0.05, min(min(f.x, 1.0-f.x), min(f.y, 1.0-f.y)));
    fcol *= mix(0.5, 1.0, hedge);
    alb = mix(alb, fcol*lum(grass)*2.0+fcol*0.2, farmW*0.85);
  }
  alb = mix(alb, sand*vec3(1.05,0.98,0.9), beachW);
  alb = mix(alb, sand*vec3(0.66,0.6,0.52), roadW*0.85);
  // neige
  float snowW = smoothstep(0.78, 0.86, h + (nz2-0.5)*0.08) * (1.0 - smoothstep(0.35, 0.75, slope));
  alb = mix(alb, vec3(0.86,0.9,0.97)*(0.55+0.65*lum(rock)), snowW);

  // humidité près de l'eau : assombrit les rives
  float shoreDark = (1.0 - smoothstep(0.0, 0.05, abs(h - uSea) )) * 0.25;
  alb *= 1.0 - shoreDark;

  // ----- éclairage -----
  vec3 L = normalize(uSun);
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float shadow = 1.0;
  if (uDetail > 0.5 && waterM < 0.5) {
    vec2 ldir = normalize(L.xy + 0.0001);
    float rise = L.z / max(0.05, length(L.xy));
    float hp = h * uHS;
    for (int i = 1; i <= 7; i++) {
      float dd = float(i) * 55.0;
      float th = texture2D(uD0, clamp(cuv + ldir * dd / uWorld, 0.0005, 0.9995)).r * uHS;
      shadow = min(shadow, smoothstep(-30.0, 40.0, hp + dd*rise - th));
    }
  }
  float cloud = fbm2(world*0.0009 + vec2(uTime*0.012, uTime*0.005));
  float cloudS = 0.84 + 0.16*smoothstep(0.32, 0.7, cloud);

  vec3 sunCol = vec3(1.0, 0.80, 0.58) * 1.55;
  vec3 ambCol = vec3(0.16, 0.21, 0.31) * (0.55 + 0.45*ao);
  vec3 lightAdd = vec3(0.0);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec4 la = uLA[i];
    if (la.w > 0.001) {
      float d = length(world - la.xy);
      float f = 1.0 - smoothstep(0.0, la.z, d);
      f *= f;
      vec3 lc = uLC[i].rgb;
      lightAdd += lc * f * la.w;
      glow += lc * f * f * la.w * 0.5;
    }
  }
  float rv0 = (1.0 - waterM);
  vec3 land = alb * (sunCol*diff*shadow*cloudS + ambCol) * (0.78 + 0.22*ao);
  land += alb * lightAdd * 1.4 + glow*0.08;

  // eau
  float depth = clamp((uSea - h)*13.0 + riverM*0.45, 0.0, 1.0);
  vec3 shallow = vec3(0.07, 0.34, 0.36), deep = vec3(0.012, 0.06, 0.11);
  vec3 wcol = mix(shallow, deep, smoothstep(0.0, 1.0, depth)) * (0.55 + 1.1*lum(wt));
  // reflet solaire / scintillement
  vec2 wn = vec2(vnoise(world*0.05 + wv*0.6), vnoise(world*0.05 + 40.0 - wv*0.5)) - 0.5;
  vec3 nw = normalize(vec3(wn*0.55, 1.0));
  vec3 R = reflect(-L, nw);
  float spec = pow(max(R.z, 0.0), 80.0);
  wcol += sunCol * spec * 0.7 * cloudS;
  wcol += vec3(0.05,0.1,0.15) * (0.5+0.5*nw.x);
  float foamBand = (1.0 - smoothstep(0.0, 0.016, abs(h - uSea + 0.004))) * (1.0-riverM);
  float foam = foamBand * (0.4 + 0.6*vnoise(world*0.06 + vec2(uTime*0.6, 0.0)));
  float riverEdge = (1.0 - smoothstep(0.0, 0.16, abs(river - 0.45))) * 0.35 * smoothstep(0.1,0.3,river);
  wcol = mix(wcol, vec3(0.8,0.9,0.92)*0.9, clamp(foam*0.55 + riverEdge*0.35, 0.0, 0.6));
  wcol = wcol*(sunCol*0.45*cloudS + ambCol*2.0) + lightAdd*0.35*vec3(0.5,0.7,0.8) + glow*0.12;
  wcol *= 0.9;

  vec3 col = mix(land, wcol, waterM);

  // ----- brume d'exploration -----
  vec2 ruv = clamp(uv, 0.0, 1.0);
  float rv = texture2D(uReveal, ruv).r;
  float wob = (fbm(world*0.0042 + vec2(uTime*0.01, 0.0)) - 0.5) * 0.5;
  float reveal = smoothstep(0.36, 0.64, rv + wob*(1.0 - abs(rv*2.0-1.0)*0.6));
  vec3 gray = vec3(lum(col));
  vec3 fogBase = mix(gray, col, 0.35) * vec3(0.20,0.26,0.34);
  float cl = fbm(world*0.0028 + vec2(uTime*0.015, uTime*0.008));
  float cl2 = fbm(world*0.0061 - vec2(uTime*0.02, uTime*0.004) + 9.0);
  vec3 mist = mix(vec3(0.045,0.07,0.1), vec3(0.2,0.25,0.31), smoothstep(0.3,0.75,cl*0.65+cl2*0.5));
  vec3 fogCol = mix(fogBase, mist, 0.78);
  // lisière dorée
  float edge = smoothstep(0.0, 0.5, 1.0 - abs(reveal - 0.5)*2.0) * (1.0 - reveal*0.35);
  fogCol += vec3(0.55,0.36,0.12) * edge * 0.32;
  col = mix(fogCol, col, reveal);

  // étalonnage
  col = col * 1.0;
  col = vec3(1.0) - exp(-col * 1.25);
  col = pow(col, vec3(1.0/2.2));
  // grain léger
  col += (hash(fc + uTime) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}
`;

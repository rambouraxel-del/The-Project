// Génération procédurale et déterministe du monde : relief, rivières, routes, emplacements, décors.
// Les données (hauteur, normales, masques) sont séparées du rendu : un futur moteur 3D peut les réutiliser.
import { Noise, mulberry32, clamp, lerp, smoothstep } from './noise';

export interface Pt { x: number; y: number }
export interface Slot extends Pt { id: number }
export type DecorAnim = 'none' | 'ship' | 'path' | 'orbit';
export interface Decor {
  id: number;
  sprite: string;       // clé de sprite
  x: number; y: number;
  size: number;         // largeur en unités monde
  rot: number;          // radians
  anim: DecorAnim;
  path?: Pt[]; pathLen?: number; speed?: number; phase?: number;
  smoke?: boolean;
  light?: { r: number; g: number; b: number; radius: number };
  flat?: boolean;       // posé au sol (pas d'ombre portée haute)
  height?: number;      // hauteur relative pour l'ombre
}
export interface Lobe { x: number; y: number; r: number }

export interface World {
  W: number; N: number; HS: number; sea: number;
  hub: Pt;
  data0: Uint8Array; // R hauteur, G humidité, B occlusion, A route
  data1: Uint8Array; // R,G normale xy, B rivière, A champs
  slots: Slot[];
  decor: Decor[];
  roads: Pt[][];
  rivers: Pt[][];
  heightAt(x: number, y: number): number;
  isWater(x: number, y: number): boolean;
}

export const WORLD_SIZE = 6400;
const N = 1024;
const SEA = 0.3;
const HS = 1500;

function catmull(pts: Pt[], seg = 12): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < seg; s++) {
      const t = s / seg, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  const k = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * n + clamp(x, 0, n - 1)];
    for (let x = 0; x < n; x++) {
      tmp[y * n + x] = acc / k;
      acc += src[y * n + Math.min(n - 1, x + r + 1)] - src[y * n + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, n - 1) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = acc / k;
      acc += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x];
    }
  }
  return out;
}

function makeMaskCanvas(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, N, N);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return { c, g };
}
function readMask(g: CanvasRenderingContext2D): Uint8Array {
  const d = g.getImageData(0, 0, N, N).data;
  const out = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) out[i] = d[i * 4];
  return out;
}

export function generateWorld(seed = 1337): World {
  const W = WORLD_SIZE;
  const cell = W / N;
  const noise = new Noise(seed);
  const noise2 = new Noise(seed + 77);
  const rnd = mulberry32(seed * 31 + 7);
  const hub: Pt = { x: W / 2, y: W / 2 };

  // ---------- relief ----------
  const h = new Float32Array(N * N);
  const moist = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
      const dx = x - hub.x, dy = y - hub.y;
      const dHub = Math.hypot(dx, dy);
      const nx = (x / W - 0.5) * 2, ny = (y / W - 0.5) * 2;
      const rr = Math.hypot(nx, ny);
      const coast = noise.fbm(x * 0.0006 + 10, y * 0.0006 + 10, 4) * 0.2;
      const island = 1 - smoothstep(0.58, 0.98, rr + coast);
      const t = noise.fbm(x * 0.0011, y * 0.0011, 6) * 0.5 + 0.5;
      const mm = smoothstep(0.36, 0.62, noise2.fbm(x * 0.00055 + 3, y * 0.00055 + 3, 3) * 0.5 + 0.5 + smoothstep(1100, 2800, dHub) * 0.3 - 0.12);
      const mount = noise.ridged(x * 0.0009 + 50, y * 0.0009 + 50, 6) * mm * smoothstep(1500, 2700, dHub);
      let v = 0.1 + island * (0.25 + 0.17 * t + 0.95 * mount);
      const hubW = 1 - smoothstep(600, 1250, dHub);
      v = lerp(v, 0.355 + 0.06 * (t - 0.5), hubW);
      h[j * N + i] = clamp(v, 0, 1);
      moist[j * N + i] = clamp(noise2.fbm(x * 0.0012 + 100, y * 0.0012 + 100, 4) * 0.9 + 0.55, 0, 1);
    }
  }

  // ---------- rivières ----------
  const rivers: Pt[][] = [];
  const wob = (pts: Pt[], amp: number, k: number) => pts.map((p, i) => i === 0 || i === pts.length - 1 ? p : ({ x: p.x + (rnd() - 0.5) * amp * k, y: p.y + (rnd() - 0.5) * amp * k }));
  const R = (dx: number, dy: number): Pt => ({ x: hub.x + dx, y: hub.y + dy });
  rivers.push(catmull(wob([R(-2300, -2100), R(-1500, -1500), R(-950, -700), R(-520, -80), R(-560, 520), R(-250, 1150), R(150, 1800), R(450, 2500), R(520, 3300)], 260, 1), 14));
  rivers.push(catmull(wob([R(2500, -1700), R(1750, -1000), R(1350, -250), R(1250, 500), R(1550, 1300), R(1500, 2100), R(1700, 3000)], 240, 1), 14));
  rivers.push(catmull(wob([R(-300, -3300), R(-180, -2500), R(250, -1900), R(500, -1250), R(380, -650), R(-420, -80)], 200, 1), 14)); // affluent nord rejoint le fleuve
  rivers.push(catmull(wob([R(-3200, 700), R(-2500, 900), R(-1800, 1300), R(-1200, 1250), R(-560, 520)], 200, 1), 14)); // affluent ouest

  const riverCv = makeMaskCanvas();
  const carveCv = makeMaskCanvas();
  rivers.forEach((path, ri) => {
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      const prog = k / path.length;
      const wMain = ri === 0 ? 1.25 : ri === 1 ? 1.05 : 0.7;
      const wid = (2.4 + prog * 4.2) * wMain; // cellules
      riverCv.g.strokeStyle = '#fff';
      riverCv.g.lineWidth = wid;
      riverCv.g.beginPath(); riverCv.g.moveTo(a.x / cell, a.y / cell); riverCv.g.lineTo(b.x / cell, b.y / cell); riverCv.g.stroke();
      carveCv.g.strokeStyle = '#fff';
      carveCv.g.lineWidth = wid * 3.2 + 4;
      carveCv.g.beginPath(); carveCv.g.moveTo(a.x / cell, a.y / cell); carveCv.g.lineTo(b.x / cell, b.y / cell); carveCv.g.stroke();
    }
  });
  const riverRaw = readMask(riverCv.g);
  const carveRaw = readMask(carveCv.g);
  const carveF = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) carveF[i] = carveRaw[i] / 255;
  const carveB = boxBlur(boxBlur(carveF, N, 9), N, 8);
  const bedF = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) bedF[i] = riverRaw[i] / 255;
  const bedB = boxBlur(bedF, N, 3);
  for (let i = 0; i < N * N; i++) {
    // vallée large et douce + lit peu profond : l'eau est portée par le masque, pas par la hauteur
    h[i] = Math.max(0, h[i] - 0.03 * clamp(carveB[i] * 2.2) - 0.016 * bedB[i]);
  }
  // un peu de lissage global pour des pentes douces
  const hs = boxBlur(h, N, 1);
  for (let i = 0; i < N * N; i++) h[i] = lerp(h[i], hs[i], 0.6);

  const heightAt = (x: number, y: number) => {
    const fx = clamp(x / cell - 0.5, 0, N - 1.001), fy = clamp(y / cell - 0.5, 0, N - 1.001);
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const a = h[iy * N + ix], b = h[iy * N + ix + 1], c = h[(iy + 1) * N + ix], d = h[(iy + 1) * N + ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  };
  const riverAt = (x: number, y: number) => {
    const ix = clamp(Math.floor(x / cell), 0, N - 1), iy = clamp(Math.floor(y / cell), 0, N - 1);
    return riverRaw[iy * N + ix] / 255;
  };
  const slopeAt = (x: number, y: number) => {
    const e = cell * 2;
    const dx = (heightAt(x + e, y) - heightAt(x - e, y)) * HS / (2 * e);
    const dy = (heightAt(x, y + e) - heightAt(x, y - e)) * HS / (2 * e);
    return Math.hypot(dx, dy);
  };
  const isWater = (x: number, y: number) => heightAt(x, y) < SEA + 0.004 || riverAt(x, y) > 0.2;
  const nearWater = (x: number, y: number, rad: number) => {
    for (let a = 0; a < 8; a++) {
      if (isWater(x + Math.cos(a * 0.785) * rad, y + Math.sin(a * 0.785) * rad)) return true;
    }
    return isWater(x, y);
  };

  // ---------- emplacements de jetons ----------
  const placed: Pt[] = [];
  const slots: Slot[] = [];
  const okLand = (x: number, y: number, maxSlope: number, hMin = SEA + 0.045, hMax = 0.58) => {
    if (x < 300 || y < 300 || x > W - 300 || y > W - 300) return false;
    const hh = heightAt(x, y);
    if (hh < hMin || hh > hMax) return false;
    if (slopeAt(x, y) > maxSlope) return false;
    return !nearWater(x, y, 70);
  };
  const farFromAll = (x: number, y: number, d: number) => placed.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 > d * d);
  // ---------- décors ----------
  const decor: Decor[] = [];
  let did = 0;
  const decorPts: Pt[] = [];
  const addDecor = (d: Omit<Decor, 'id'>) => { decor.push({ id: did++, ...d }); };
  const free = (x: number, y: number, dSlot: number, dDecor: number) =>
    decorPts.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 > dDecor * dDecor);
  interface Rule { sprite: string; n: number; size: [number, number]; slope: number; hMin?: number; hMax?: number; near?: boolean; dHubMin?: number; dHubMax?: number; sep: number; flat?: boolean; smoke?: boolean; height?: number; light?: Decor['light']; rotRand?: boolean }
  const rules: Rule[] = [
    { sprite: 'castle_a', n: 2, size: [430, 430], slope: 0.45, dHubMin: 1050, dHubMax: 2200, sep: 500, height: 0.9 },
    { sprite: 'castle_b', n: 3, size: [400, 440], slope: 0.7, hMin: 0.48, hMax: 0.7, dHubMin: 1900, dHubMax: 3200, sep: 700, height: 1 },
    { sprite: 'village_a', n: 5, size: [330, 380], slope: 0.35, dHubMin: 560, dHubMax: 3000, sep: 700, smoke: true, rotRand: true, height: 0.25 },
    { sprite: 'village_b', n: 5, size: [330, 380], slope: 0.35, dHubMin: 640, dHubMax: 3000, sep: 700, smoke: true, rotRand: true, height: 0.3 },
    { sprite: 'village_c', n: 4, size: [280, 330], slope: 0.35, near: true, dHubMin: 520, dHubMax: 3100, sep: 600, smoke: true, rotRand: true, height: 0.25 },
    { sprite: 'abbey', n: 2, size: [400, 440], slope: 0.4, dHubMin: 1500, dHubMax: 3000, sep: 900, height: 0.5 },
    { sprite: 'windmill', n: 5, size: [210, 240], slope: 0.4, dHubMin: 520, dHubMax: 2800, sep: 600, height: 0.6 },
    { sprite: 'farm', n: 6, size: [250, 300], slope: 0.3, dHubMin: 500, dHubMax: 2800, sep: 500, height: 0.2, rotRand: true },
    { sprite: 'ruins_a', n: 6, size: [300, 360], slope: 0.7, dHubMin: 560, dHubMax: 3200, sep: 520, flat: true, height: 0.15, rotRand: true },
    { sprite: 'ruins_b', n: 5, size: [250, 300], slope: 0.8, hMin: 0.4, dHubMin: 1100, dHubMax: 3200, sep: 520, flat: true, height: 0.35, rotRand: true },
    { sprite: 'tower', n: 5, size: [150, 170], slope: 0.8, hMin: 0.45, hMax: 0.72, dHubMin: 1100, dHubMax: 3200, sep: 500, height: 1 },
    { sprite: 'stones', n: 4, size: [250, 280], slope: 0.45, dHubMin: 620, dHubMax: 3000, sep: 700, flat: true, height: 0.1 },
    { sprite: 'camp', n: 6, size: [190, 220], slope: 0.35, dHubMin: 480, dHubMax: 3000, sep: 500, height: 0.2, rotRand: true, light: { r: 1, g: 0.55, b: 0.2, radius: 360 } },
  ];
  for (const rule of rules) {
    let count = 0;
    for (let tries = 0; tries < 4000 && count < rule.n; tries++) {
      const ang = rnd() * Math.PI * 2;
      const dist = lerp(rule.dHubMin ?? 600, rule.dHubMax ?? 3000, rnd());
      const x = hub.x + Math.cos(ang) * dist, y = hub.y + Math.sin(ang) * dist;
      if (!okLand(x, y, rule.slope, rule.hMin ?? SEA + 0.045, rule.hMax ?? 0.6)) continue;
      if (rule.near && !nearWater(x, y, 160)) continue;
      if (!free(x, y, 250, rule.sep)) continue;
      const sz = lerp(rule.size[0], rule.size[1], rnd());
      addDecor({
        sprite: rule.sprite, x, y, size: sz, rot: rule.rotRand ? rnd() * Math.PI * 2 : (rnd() - 0.5) * 0.4, anim: 'none',
        smoke: rule.smoke, light: rule.light, flat: rule.flat, height: rule.height,
      });
      decorPts.push({ x, y }); count++;
    }
  }

  // anneau 1 : autour du hub (garantit un premier territoire accueillant)
  const slotMin = 330;
  for (let tries = 0; tries < 9000 && slots.length < 84; tries++) {
    const ang = rnd() * Math.PI * 2;
    const dist = Math.sqrt(rnd()) * (tries < 2500 ? 950 : 3000);
    const x = hub.x + Math.cos(ang) * dist, y = hub.y + Math.sin(ang) * dist;
    if (!okLand(x, y, 0.55)) continue;
    if (!farFromAll(x, y, slotMin)) continue;
    if (decorPts.some(p => (p.x - x) ** 2 + (p.y - y) ** 2 < 235 * 235)) continue;
    const s = { id: slots.length, x, y };
    slots.push(s); placed.push({ x, y });
  }
  // tri par distance au hub, ré-indexation stable
  slots.sort((a, b) => Math.hypot(a.x - hub.x, a.y - hub.y) - Math.hypot(b.x - hub.x, b.y - hub.y));
  slots.forEach((s, i) => (s.id = i));

  // ---------- routes (arbre couvrant minimal entre points d'intérêt) ----------
  const nodes: Pt[] = [hub, ...slots, ...decor.filter(d => !['ruins_a', 'ruins_b', 'stones', 'tower'].includes(d.sprite)).map(d => ({ x: d.x, y: d.y }))];
  const crossCost = (a: Pt, b: Pt) => {
    const steps = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 50);
    let sea = 0, riv = 0, steep = 0;
    for (let s = 1; s < steps; s++) {
      const t = s / steps, x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t);
      if (heightAt(x, y) < SEA + 0.004) sea++;
      else if (riverAt(x, y) > 0.2) riv++;
      steep += slopeAt(x, y) > 0.9 ? 1 : 0;
    }
    return { sea, riv, steep };
  };
  const inTree = new Array(nodes.length).fill(false);
  inTree[0] = true;
  const edges: [number, number][] = [];
  const best = nodes.map((n, i) => ({ d: Infinity, from: -1, i }));
  const edgeCost = (i: number, j: number) => {
    const a = nodes[i], b = nodes[j];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 2200) return Infinity;
    const c = crossCost(a, b);
    if (c.sea > 0) return Infinity;
    return d + c.riv * 1500 + c.steep * 90;
  };
  for (let j = 1; j < nodes.length; j++) { best[j].d = edgeCost(0, j); best[j].from = 0; }
  for (let k = 1; k < nodes.length; k++) {
    let bi = -1, bd = Infinity;
    for (let j = 0; j < nodes.length; j++) if (!inTree[j] && best[j].d < bd) { bd = best[j].d; bi = j; }
    if (bi < 0) break;
    inTree[bi] = true;
    edges.push([best[bi].from, bi]);
    for (let j = 0; j < nodes.length; j++) {
      if (inTree[j]) continue;
      const c = edgeCost(bi, j);
      if (c < best[j].d) { best[j].d = c; best[j].from = bi; }
    }
  }
  const roads: Pt[][] = [];
  const roadCv = makeMaskCanvas();
  const bridges: { x: number; y: number; rot: number }[] = [];
  for (const [i, j] of edges) {
    const a = nodes[i], b = nodes[j];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const segs = Math.max(2, Math.round(dist / 160));
    const nx = -(b.y - a.y) / dist, ny = (b.x - a.x) / dist;
    const pts: Pt[] = [a];
    for (let s = 1; s < segs; s++) {
      const t = s / segs;
      const off = noise.n(a.x * 0.01 + s * 1.7, a.y * 0.01 + j * 0.3) * 55;
      pts.push({ x: lerp(a.x, b.x, t) + nx * off, y: lerp(a.y, b.y, t) + ny * off });
    }
    pts.push(b);
    const path = catmull(pts, 6);
    roads.push(path);
    // pont à chaque traversée de rivière
    let inRiver = false, enter = 0;
    for (let k = 0; k < path.length; k++) {
      const r = riverAt(path[k].x, path[k].y) > 0.25;
      if (r && !inRiver) { inRiver = true; enter = k; }
      if (!r && inRiver) {
        inRiver = false;
        const mid = path[Math.floor((enter + k) / 2)];
        const p0 = path[Math.max(0, enter - 2)], p1 = path[Math.min(path.length - 1, k + 2)];
        bridges.push({ x: mid.x, y: mid.y, rot: Math.atan2(p1.y - p0.y, p1.x - p0.x) });
      }
    }
  }
  roadCv.g.strokeStyle = '#fff';
  for (const path of roads) {
    roadCv.g.lineWidth = 2.6;
    roadCv.g.beginPath();
    path.forEach((p, k) => (k ? roadCv.g.lineTo(p.x / cell, p.y / cell) : roadCv.g.moveTo(p.x / cell, p.y / cell)));
    roadCv.g.stroke();
  }
  // dais / cours autour des bâtiments : clairières de terre
  for (const d of decor) {
    if (['castle_a', 'castle_b', 'abbey', 'village_a', 'village_b', 'village_c', 'farm', 'windmill', 'camp'].includes(d.sprite)) {
      const g = roadCv.g.createRadialGradient(d.x / cell, d.y / cell, 0, d.x / cell, d.y / cell, d.size * 0.42 / cell);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      roadCv.g.fillStyle = g;
      roadCv.g.beginPath(); roadCv.g.arc(d.x / cell, d.y / cell, d.size * 0.42 / cell, 0, 6.3); roadCv.g.fill();
    }
  }
  for (const s of slots) {
    const g = roadCv.g.createRadialGradient(s.x / cell, s.y / cell, 0, s.x / cell, s.y / cell, 120 / cell);
    g.addColorStop(0, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    roadCv.g.fillStyle = g;
    roadCv.g.beginPath(); roadCv.g.arc(s.x / cell, s.y / cell, 120 / cell, 0, 6.3); roadCv.g.fill();
  }
  const roadRaw = readMask(roadCv.g);

  // champs autour des villages et fermes
  const farmCv = makeMaskCanvas();
  for (const d of decor) {
    if (['village_a', 'village_b', 'village_c', 'farm', 'windmill'].includes(d.sprite)) {
      const rad = (d.sprite === 'farm' || d.sprite === 'windmill' ? 330 : 520) / cell;
      const g = farmCv.g.createRadialGradient(d.x / cell, d.y / cell, rad * 0.25, d.x / cell, d.y / cell, rad);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      farmCv.g.fillStyle = g;
      farmCv.g.beginPath(); farmCv.g.arc(d.x / cell, d.y / cell, rad, 0, 6.3); farmCv.g.fill();
    }
  }
  const farmRaw = readMask(farmCv.g);

  // ponts, navires, caravanes, chevaliers, dragon
  for (const b of bridges) addDecor({ sprite: 'bridge', x: b.x, y: b.y, rot: b.rot, size: 190, anim: 'none', flat: true, height: 0.1 });
  let shipN = 0;
  for (let tries = 0; tries < 3000 && shipN < 6; tries++) {
    const x = rnd() * W, y = rnd() * W;
    const hh = heightAt(x, y);
    if (hh > SEA - 0.06 || hh < 0.04) continue;
    if (Math.hypot(x - hub.x, y - hub.y) < 1500) continue;
    if (!free(x, y, 0, 420)) continue;
    // doit être proche de la côte, pas seulement dans l'océan lointain
    let coast = false;
    for (let a = 0; a < 12; a++) if (heightAt(x + Math.cos(a * 0.52) * 500, y + Math.sin(a * 0.52) * 500) > SEA + 0.01) coast = true;
    if (!coast) continue;
    addDecor({ sprite: 'ship', x, y, rot: rnd() * 6.28, size: 150, anim: 'ship', speed: 8 + rnd() * 6, phase: rnd() * 10, height: 0.5 });
    decorPts.push({ x, y }); shipN++;
  }
  const longRoads = roads.filter(r => r.length > 25).sort((a, b) => b.length - a.length);
  const mkPath = (road: Pt[]) => {
    let len = 0;
    for (let i = 1; i < road.length; i++) len += Math.hypot(road[i].x - road[i - 1].x, road[i].y - road[i - 1].y);
    return len;
  };
  const moving: [string, number, number][] = [['caravan', 100, 26], ['caravan', 100, 20], ['knights', 130, 34], ['caravan', 100, 22], ['knights', 130, 30]];
  moving.forEach(([sprite, size, speed], i) => {
    const road = longRoads[i % Math.max(1, longRoads.length)];
    if (!road) return;
    addDecor({ sprite, x: road[0].x, y: road[0].y, rot: 0, size, anim: 'path', path: road, pathLen: mkPath(road), speed, phase: rnd() * 400, height: 0.3 });
  });
  addDecor({ sprite: 'dragon', x: hub.x - 1900, y: hub.y - 1700, rot: 0, size: 420, anim: 'orbit', speed: 0.05, phase: 0, height: 3 });

  // ---------- normales, occlusion, textures de données ----------
  const hb = boxBlur(h, N, 6);
  const data0 = new Uint8Array(N * N * 4);
  const data1 = new Uint8Array(N * N * 4);
  const wetBlur = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) wetBlur[i] = riverRaw[i] / 255;
  const wetB = boxBlur(boxBlur(wetBlur, N, 10), N, 10);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const hl = h[j * N + Math.max(0, i - 1)], hr = h[j * N + Math.min(N - 1, i + 1)];
      const hu = h[Math.max(0, j - 1) * N + i], hd = h[Math.min(N - 1, j + 1) * N + i];
      const ddx = (hr - hl) * HS / (2 * cell), ddy = (hd - hu) * HS / (2 * cell);
      const inv = 1 / Math.hypot(ddx, ddy, 1);
      const nxv = -ddx * inv, nyv = -ddy * inv;
      const ao = clamp(0.62 + (h[k] - hb[k]) * 9, 0.25, 1);
      data0[k * 4] = Math.round(clamp(h[k]) * 255);
      data0[k * 4 + 1] = Math.round(clamp(moist[k] + wetB[k] * 1.2) * 255);
      data0[k * 4 + 2] = Math.round(ao * 255);
      data0[k * 4 + 3] = roadRaw[k];
      data1[k * 4] = Math.round((nxv * 0.5 + 0.5) * 255);
      data1[k * 4 + 1] = Math.round((nyv * 0.5 + 0.5) * 255);
      data1[k * 4 + 2] = riverRaw[k];
      data1[k * 4 + 3] = farmRaw[k];
    }
  }

  return { W, N, HS, sea: SEA, hub, data0, data1, slots, decor, roads, rivers, heightAt, isWater };
}

// ---------- territoire ----------
export function slotUnlocked(s: Pt, lobes: Lobe[]): boolean {
  return lobes.some(l => Math.hypot(s.x - l.x, s.y - l.y) < l.r * 0.94);
}

/** Choisit le prochain lobe d'exploration : le plus proche emplacement encore dans la brume. */
export function nextLobe(world: World, lobes: Lobe[]): Lobe {
  let best: Slot | null = null, bd = Infinity;
  for (const s of world.slots) {
    if (slotUnlocked(s, lobes)) continue;
    let d = Infinity;
    for (const l of lobes) d = Math.min(d, Math.hypot(s.x - l.x, s.y - l.y) - l.r);
    if (d < bd) { bd = d; best = s; }
  }
  if (!best) return { x: world.hub.x, y: world.hub.y, r: 0 };
  // centre du lobe : légèrement décalé vers l'intérieur pour une expansion organique
  let cx = best.x, cy = best.y;
  const near = world.slots.filter(s => !slotUnlocked(s, lobes) && Math.hypot(s.x - best!.x, s.y - best!.y) < 700);
  if (near.length > 1) {
    cx = near.reduce((a, s) => a + s.x, 0) / near.length;
    cy = near.reduce((a, s) => a + s.y, 0) / near.length;
  }
  const r = 620 + Math.min(260, Math.hypot(cx - best.x, cy - best.y)) ;
  return { x: cx, y: cy, r };
}

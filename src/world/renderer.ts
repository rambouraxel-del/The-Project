import { FRAG, VERT, MAX_LIGHTS } from './shaders';
import type { World, Lobe, Decor } from './worldgen';
import { clamp, smoothstep } from './noise';

export interface Camera { x: number; y: number; zoom: number }
export interface Light { x: number; y: number; r: number; g: number; b: number; radius: number; intensity: number }
export interface LobeAnim extends Lobe { p: number }

export const SPRITE_KEYS = ['castle_a', 'castle_b', 'village_a', 'village_b', 'village_c', 'ruins_a', 'ruins_b', 'tower', 'windmill', 'farm', 'camp', 'stones', 'abbey', 'bridge', 'ship', 'caravan', 'knights', 'dragon', 'dais_a', 'dais_b'];
export const TEX_KEYS = ['grass', 'forest', 'rock', 'sand', 'water'];

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image ' + src));
    im.src = src;
  });
}

export interface Assets {
  tex: Record<string, HTMLImageElement>;
  spr: Record<string, HTMLImageElement>;
}

export async function loadAssets(base: string, onProgress?: (p: number) => void): Promise<Assets> {
  const tex: Record<string, HTMLImageElement> = {}, spr: Record<string, HTMLImageElement> = {};
  const total = TEX_KEYS.length + SPRITE_KEYS.length;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  await Promise.all([
    ...TEX_KEYS.map(k => loadImage(`${base}assets/tex/${k}.jpg`).then(i => { tex[k] = i; tick(); })),
    ...SPRITE_KEYS.map(k => loadImage(`${base}assets/spr/${k}.webp`).then(i => { spr[k] = i; tick(); }).catch(() => { tick(); })),
  ]);
  return { tex, spr };
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}

/** Ombre floue pré-calculée d'un sprite (silhouette réduite puis agrandie = flou bon marché, compatible Safari). */
function makeShadow(img: HTMLImageElement): HTMLCanvasElement {
  const w = 64, h = Math.max(8, Math.round(64 * img.height / img.width));
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const g = small.getContext('2d')!;
  g.drawImage(img, 0, 0, w, h);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#0a0705';
  g.fillRect(0, 0, w, h);
  return small;
}

interface Puff { x: number; y: number; age: number; life: number; vx: number }

export class WorldRenderer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private revealTex: WebGLTexture;
  private revealCv = document.createElement('canvas');
  private revealCtx: CanvasRenderingContext2D;
  private ctx: CanvasRenderingContext2D;
  private shadows: Record<string, HTMLCanvasElement> = {};
  private lobes: LobeAnim[] = [];
  private lights: Light[] = [];
  private puffs: Puff[] = [];
  private lastT = 0;
  revealDirty = true;
  w = 0; h = 0; dpr = 1;
  sun = { az: 2.3, el: 0.62 };
  detail = 1;
  readonly slotOrder: Decor[] = [];

  constructor(private canvas: HTMLCanvasElement, private decorCanvas: HTMLCanvasElement, private world: World, private assets: Assets) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })!;
    if (!gl) throw new Error('WebGL indisponible');
    this.gl = gl;
    this.ctx = decorCanvas.getContext('2d')!;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const names = ['uRes', 'uCam', 'uScale', 'uTime', 'uWorld', 'uHS', 'uSea', 'uSun', 'uDetail', 'uD0', 'uD1', 'uReveal', 'uGrass', 'uForest', 'uRock', 'uSand', 'uWater', 'uLA', 'uLC'];
    for (const n of names) this.u[n] = gl.getUniformLocation(prog, n);

    const mkTex = (unit: number, w: number, h: number, data: ArrayBufferView | null, opt: { repeat?: boolean; linear?: boolean; mip?: boolean; src?: TexImageSource } = {}) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (opt.src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, opt.src);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      if (opt.mip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opt.mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrap = opt.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return t;
    };
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    mkTex(0, world.N, world.N, world.data0);
    mkTex(1, world.N, world.N, world.data1);
    this.revealCv.width = this.revealCv.height = 256;
    this.revealCtx = this.revealCv.getContext('2d', { willReadFrequently: false })!;
    this.revealTex = mkTex(2, 256, 256, null, { src: this.revealCv });
    const texOrder = ['grass', 'forest', 'rock', 'sand', 'water'];
    const texOpt = { repeat: true, mip: true };
    texOrder.forEach((k, i) => {
      // les textures doivent être POT pour REPEAT + mipmaps en WebGL1
      const im = assets.tex[k];
      const c = document.createElement('canvas');
      c.width = c.height = 1024;
      c.getContext('2d')!.drawImage(im, 0, 0, 1024, 1024);
      mkTex(3 + i, 1024, 1024, null, { ...texOpt, src: c });
    });
    ['uD0', 'uD1', 'uReveal', 'uGrass', 'uForest', 'uRock', 'uSand', 'uWater'].forEach((n, i) => gl.uniform1i(this.u[n], i));
    gl.uniform1f(this.u.uWorld, world.W);
    gl.uniform1f(this.u.uHS, world.HS);
    gl.uniform1f(this.u.uSea, world.sea);

    for (const k of Object.keys(assets.spr)) this.shadows[k] = makeShadow(assets.spr[k]);
  }

  setLobes(l: LobeAnim[]) { this.lobes = l; this.revealDirty = true; }
  setLights(l: Light[]) { this.lights = l; }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = dpr;
    for (const c of [this.canvas, this.decorCanvas]) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.width = w + 'px'; c.style.height = h + 'px';
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private uploadReveal() {
    const g = this.revealCtx, s = 256 / this.world.W;
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'lighter';
    for (const l of this.lobes) {
      const R = l.r * l.p * 1.12 * s;
      if (R < 0.5) continue;
      const gr = g.createRadialGradient(l.x * s, l.y * s, 0, l.x * s, l.y * s, R);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.7, '#fff'); gr.addColorStop(1, '#000');
      g.fillStyle = gr;
      g.beginPath(); g.arc(l.x * s, l.y * s, R, 0, 7); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.revealTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.revealCv);
    this.revealDirty = false;
  }

  /** valeur de dévoilement 0..1 en un point monde (cohérente avec la texture) */
  revealAt(x: number, y: number): number {
    let best = 0;
    for (const l of this.lobes) {
      const R = l.r * l.p * 1.12;
      if (R < 1) continue;
      const d = Math.hypot(x - l.x, y - l.y) / R;
      const v = d < 0.7 ? 1 : d > 1 ? 0 : 1 - (d - 0.7) / 0.3;
      if (v > best) best = v;
    }
    return smoothstep(0.38, 0.66, best);
  }

  sunVec(): [number, number, number] {
    const { az, el } = this.sun;
    return [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
  }

  render(cam: Camera, time: number) {
    const gl = this.gl;
    if (this.revealDirty) this.uploadReveal();
    const scale = cam.zoom * this.dpr;
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u.uCam, cam.x, cam.y);
    gl.uniform1f(this.u.uScale, scale);
    gl.uniform1f(this.u.uTime, time);
    gl.uniform1f(this.u.uDetail, this.detail);
    const s = this.sunVec();
    gl.uniform3f(this.u.uSun, s[0], s[1], s[2]);
    // lumières : les plus proches du centre de la vue
    const view = Math.max(this.w, this.h) / cam.zoom;
    const vis = this.lights
      .map(l => ({ l, d: Math.hypot(l.x - cam.x, l.y - cam.y) }))
      .filter(o => o.d < view * 0.75 + o.l.radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_LIGHTS);
    const la = new Float32Array(MAX_LIGHTS * 4), lc = new Float32Array(MAX_LIGHTS * 4);
    vis.forEach(({ l }, i) => {
      const flick = 0.88 + 0.12 * Math.sin(time * 7 + i * 3.1) * Math.sin(time * 3.3 + i);
      la.set([l.x, l.y, l.radius, l.intensity * flick], i * 4);
      lc.set([l.r, l.g, l.b, 0], i * 4);
    });
    gl.uniform4fv(this.u.uLA, la);
    gl.uniform4fv(this.u.uLC, lc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawDecor(cam, time);
  }

  private pathPos(d: Decor, time: number) {
    const path = d.path!, len = d.pathLen!;
    // aller-retour sur la route
    const dist = ((time * (d.speed ?? 20) + (d.phase ?? 0)) % (len * 2));
    const t = dist <= len ? dist : len * 2 - dist;
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const sl = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (acc + sl >= t) {
        const f = (t - acc) / sl;
        const x = path[i - 1].x + (path[i].x - path[i - 1].x) * f, y = path[i - 1].y + (path[i].y - path[i - 1].y) * f;
        let ang = Math.atan2(path[i].y - path[i - 1].y, path[i].x - path[i - 1].x);
        if (dist > len) ang += Math.PI;
        return { x, y, ang };
      }
      acc += sl;
    }
    return { x: path[path.length - 1].x, y: path[path.length - 1].y, ang: 0 };
  }

  /** Position animée d'un décor */
  decorPose(d: Decor, time: number): { x: number; y: number; rot: number; z: number } {
    if (d.anim === 'ship') {
      const a = d.rot + Math.sin(time * 0.05 + (d.phase ?? 0)) * 0.6;
      const dist = Math.sin(time * 0.02 * (d.speed ?? 8) * 0.2 + (d.phase ?? 0)) * 160;
      return { x: d.x + Math.cos(d.rot) * dist, y: d.y + Math.sin(d.rot) * dist, rot: d.rot + (Math.cos(time * 0.02 * (d.speed ?? 8) * 0.2 + (d.phase ?? 0)) >= 0 ? 0 : Math.PI) + Math.sin(time * 1.3) * 0.03, z: 0 + 0 * a };
    }
    if (d.anim === 'path' && d.path) {
      const p = this.pathPos(d, time);
      return { x: p.x, y: p.y, rot: p.ang + Math.PI / 2 * 0, z: 0 };
    }
    if (d.anim === 'orbit') {
      const a = time * (d.speed ?? 0.05) + (d.phase ?? 0);
      return { x: d.x + Math.cos(a) * 900, y: d.y + Math.sin(a * 1.3) * 520, rot: Math.atan2(Math.cos(a * 1.3) * 520 * 1.3, -Math.sin(a) * 900) + Math.PI / 2, z: 1 };
    }
    return { x: d.x, y: d.y, rot: d.rot, z: 0 };
  }

  private drawDecor(cam: Camera, time: number) {
    const ctx = this.ctx, dpr = this.dpr, z = cam.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.decorCanvas.width, this.decorCanvas.height);
    const dt = Math.min(0.1, time - this.lastT || 0.016);
    this.lastT = time;
    const sun = this.sunVec();
    const sl = Math.hypot(sun[0], sun[1]) || 1;
    const shx = -sun[0] / sl, shy = -sun[1] / sl; // direction de l'ombre au sol
    const sx = (wx: number) => ((wx - cam.x) * z + this.w / 2) * dpr;
    const sy = (wy: number) => ((wy - cam.y) * z + this.h / 2) * dpr;
    const margin = 450;
    const x0 = cam.x - this.w / 2 / z - margin, x1 = cam.x + this.w / 2 / z + margin;
    const y0 = cam.y - this.h / 2 / z - margin, y1 = cam.y + this.h / 2 / z + margin;
    const items: { d: Decor; x: number; y: number; rot: number; a: number; zz: number }[] = [];
    for (const d of this.world.decor) {
      const p = this.decorPose(d, time);
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const a = this.revealAt(p.x, p.y);
      if (a < 0.02) continue;
      items.push({ d, x: p.x, y: p.y, rot: p.rot, a, zz: p.z });
    }
    // socles des emplacements débloqués
    const daisItems: { x: number; y: number; a: number; k: string }[] = [];
    for (const s of this.world.slots) {
      if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
      const a = this.revealAt(s.x, s.y);
      if (a < 0.02) continue;
      daisItems.push({ x: s.x, y: s.y, a, k: s.id % 2 ? 'dais_a' : 'dais_b' });
    }
    ctx.imageSmoothingQuality = 'high';
    // ombres
    for (const it of items) {
      const sh = this.shadows[it.d.sprite]; if (!sh) continue;
      const img = this.assets.spr[it.d.sprite];
      const w = it.d.size * z * dpr, hh = w * img.height / img.width;
      const hgt = (it.d.height ?? 0.3) * it.d.size * (it.zz ? 1.8 : 0.35);
      const ox = shx * hgt * z * dpr * 0.6, oy = shy * hgt * z * dpr * 0.6;
      ctx.save();
      ctx.translate(sx(it.x) + ox, sy(it.y) + oy);
      ctx.rotate(it.d.flat ? it.rot : it.rot * 0);
      ctx.globalAlpha = (it.d.flat ? 0.35 : 0.5) * it.a * (it.zz ? 0.6 : 1);
      const sw = w * (it.d.flat ? 1.05 : 1.12), sh2 = hh * (it.d.flat ? 1.05 : 1.12);
      ctx.drawImage(sh, -sw / 2, -sh2 / 2, sw, sh2);
      ctx.restore();
    }
    for (const it of daisItems) {
      const sh = this.shadows[it.k], img = this.assets.spr[it.k];
      if (!img) continue;
      const w = 260 * z * dpr, hh = w * img.height / img.width;
      ctx.save();
      ctx.globalAlpha = 0.5 * it.a;
      ctx.drawImage(sh, sx(it.x) - w * 0.55, sy(it.y) - hh * 0.5 + hh * 0.08, w * 1.1, hh * 1.1);
      ctx.restore();
    }
    for (const it of daisItems) {
      const img = this.assets.spr[it.k]; if (!img) continue;
      const w = 250 * z * dpr, hh = w * img.height / img.width;
      ctx.globalAlpha = it.a;
      ctx.drawImage(img, sx(it.x) - w / 2, sy(it.y) - hh / 2, w, hh);
    }
    ctx.globalAlpha = 1;
    // sprites triés par y
    const ground = items.filter(i => !i.zz).sort((a, b) => a.y - b.y);
    for (const it of ground) {
      const img = this.assets.spr[it.d.sprite]; if (!img) continue;
      const w = it.d.size * z * dpr, hh = w * img.height / img.width;
      ctx.save();
      ctx.translate(sx(it.x), sy(it.y));
      let rot = it.rot;
      if (it.d.anim === 'path' || it.d.anim === 'ship') rot = it.rot + Math.PI / 2;
      ctx.rotate(it.d.sprite === 'bridge' ? it.rot : it.d.anim === 'none' && !it.d.flat && it.d.sprite.startsWith('village') ? it.rot : rot);
      ctx.globalAlpha = it.a;
      ctx.drawImage(img, -w / 2, -hh / 2, w, hh);
      ctx.restore();
    }
    // fumée des villages
    if (z > 0.16) {
      for (const it of ground) {
        if (!it.d.smoke) continue;
        if (Math.random() < dt * 1.6) this.puffs.push({ x: it.x + (Math.random() - 0.5) * it.d.size * 0.4, y: it.y + (Math.random() - 0.5) * it.d.size * 0.3, age: 0, life: 4 + Math.random() * 3, vx: 6 + Math.random() * 6 });
      }
    }
    this.puffs = this.puffs.filter(p => (p.age += dt) < p.life);
    for (const p of this.puffs) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const t = p.age / p.life;
      const r = (6 + t * 26) * z * dpr;
      ctx.globalAlpha = 0.16 * (1 - t) * smoothstep(0, 0.1, t) * this.revealAt(p.x, p.y);
      ctx.fillStyle = '#d8d2c8';
      ctx.beginPath(); ctx.arc(sx(p.x + p.vx * p.age), sy(p.y - 30 * p.age), r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // créatures volantes (ombre au sol + sprite)
    for (const it of items.filter(i => i.zz)) {
      const img = this.assets.spr[it.d.sprite]; if (!img) continue;
      const w = it.d.size * z * dpr * 1.1, hh = w * img.height / img.width;
      const flap = 1 + Math.sin(time * 5) * 0.06;
      ctx.save();
      ctx.translate(sx(it.x) + shx * 160 * z * dpr, sy(it.y) + shy * 160 * z * dpr);
      ctx.rotate(it.rot);
      ctx.globalAlpha = 0.3 * it.a;
      ctx.drawImage(this.shadows[it.d.sprite], -w * 0.5 * flap, -hh * 0.5, w * flap, hh);
      ctx.restore();
      ctx.save();
      ctx.translate(sx(it.x), sy(it.y));
      ctx.rotate(it.rot);
      ctx.globalAlpha = it.a;
      ctx.drawImage(img, -w * 0.5 * flap, -hh * 0.5, w * flap, hh);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** Vignette de lumière chaude + capture */
  snapshot(): string { return this.canvas.toDataURL('image/jpeg', 0.8); }

  clampCam(cam: Camera) {
    const W = this.world.W;
    cam.zoom = clamp(cam.zoom, this.minZoom(), 1.7);
    const hw = this.w / 2 / cam.zoom, hh = this.h / 2 / cam.zoom;
    const pad = 300;
    cam.x = clamp(cam.x, Math.min(W / 2, hw - pad), Math.max(W / 2, W - hw + pad));
    cam.y = clamp(cam.y, Math.min(W / 2, hh - pad), Math.max(W / 2, W - hh + pad));
  }
  minZoom() { return Math.max(0.12, Math.max(this.w, this.h) / (this.world.W * 0.9)); }
}

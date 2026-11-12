// Bruit déterministe (gradient 2D) + utilitaires de génération.
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise {
  private perm = new Uint8Array(512);
  private gx = new Float32Array(256);
  private gy = new Float32Array(256);
  constructor(seed: number) {
    const r = mulberry32(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
      const a = r() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }
  /** bruit de gradient, valeurs ~[-1,1] */
  n(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const X = xi & 255, Y = yi & 255;
    const p = this.perm;
    const h00 = p[p[X] + Y], h10 = p[p[X + 1] + Y], h01 = p[p[X] + Y + 1], h11 = p[p[X + 1] + Y + 1];
    const d00 = this.gx[h00] * xf + this.gy[h00] * yf;
    const d10 = this.gx[h10] * (xf - 1) + this.gy[h10] * yf;
    const d01 = this.gx[h01] * xf + this.gy[h01] * (yf - 1);
    const d11 = this.gx[h11] * (xf - 1) + this.gy[h11] * (yf - 1);
    const a = d00 + (d10 - d00) * u;
    const b = d01 + (d11 - d01) * u;
    return (a + (b - a) * v) * 1.41;
  }
  fbm(x: number, y: number, oct = 5, lac = 2, gain = 0.5): number {
    let s = 0, a = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += this.n(x * f, y * f) * a;
      norm += a; a *= gain; f *= lac;
    }
    return s / norm;
  }
  ridged(x: number, y: number, oct = 5): number {
    let s = 0, a = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(this.n(x * f, y * f));
      v *= v;
      s += v * a; norm += a; a *= 0.5; f *= 2;
    }
    return s / norm;
  }
}

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const hypot = Math.hypot;

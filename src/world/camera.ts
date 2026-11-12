import type { Camera } from './renderer';
import { clamp } from './noise';

export interface MapInputCallbacks {
  /** convertit les coordonnées écran en monde */
  clamp(cam: Camera): void;
  changed(): void;
  tapToken(id: string): void;
  tapSlot(id: number): void;
  dragStart(id: string): void;
  dragMove(id: string, clientX: number, clientY: number): void;
  dragEnd(id: string, clientX: number, clientY: number): void;
  enabled(): boolean;
}

const HOLD_MS = 340;
const MOVE_PX = 8;

/** Gestes de la carte : déplacement, pincement, molette, inertie, appui long sur un jeton pour le repositionner. */
export class MapInput {
  private ptrs = new Map<number, { x: number; y: number }>();
  private last = { x: 0, y: 0, t: 0 };
  private vel = { x: 0, y: 0 };
  private pinch: { d: number; zoom: number } | null = null;
  private tokenCand: { id: string; pid: number; sx: number; sy: number; timer: number; touch: boolean } | null = null;
  private slotCand: { id: number; sx: number; sy: number } | null = null;
  private dragging: string | null = null;
  private moved = false;
  private anim: { raf: number } | null = null;
  private flyRaf = 0;
  active = false;

  constructor(private el: HTMLElement, public cam: Camera, private cb: MapInputCallbacks) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('dblclick', this.dbl);
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) el.addEventListener(ev, e => e.preventDefault());
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  private vw() { return this.el.clientWidth; }
  private vh() { return this.el.clientHeight; }
  toWorld(cx: number, cy: number) {
    const r = this.el.getBoundingClientRect();
    return { x: this.cam.x + (cx - r.left - this.vw() / 2) / this.cam.zoom, y: this.cam.y + (cy - r.top - this.vh() / 2) / this.cam.zoom };
  }

  private stopMotion() {
    if (this.anim) { cancelAnimationFrame(this.anim.raf); this.anim = null; }
    if (this.flyRaf) { cancelAnimationFrame(this.flyRaf); this.flyRaf = 0; }
  }

  private down = (e: PointerEvent) => {
    if (!this.cb.enabled()) return;
    const target = e.target as HTMLElement;
    this.stopMotion();
    this.el.setPointerCapture?.(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.moved = false;
    this.active = true;
    if (this.ptrs.size === 1) {
      this.last = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.vel = { x: 0, y: 0 };
      const tokEl = target.closest('.token') as HTMLElement | null;
      const slotEl = target.closest('.slot-free') as HTMLElement | null;
      if (tokEl && tokEl.dataset.id) {
        const touch = e.pointerType !== 'mouse';
        const id = tokEl.dataset.id;
        const timer = window.setTimeout(() => {
          if (this.tokenCand && this.tokenCand.id === id && !this.moved) {
            this.dragging = id;
            this.cb.dragStart(id);
            navigator.vibrate?.(12);
          }
        }, HOLD_MS);
        this.tokenCand = { id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, timer, touch };
      } else if (slotEl && slotEl.dataset.slot) {
        this.slotCand = { id: +slotEl.dataset.slot, sx: e.clientX, sy: e.clientY };
      }
    } else if (this.ptrs.size === 2) {
      this.cancelCandidates();
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.cam.zoom };
    }
  };

  private cancelCandidates() {
    if (this.tokenCand) { clearTimeout(this.tokenCand.timer); this.tokenCand = null; }
    this.slotCand = null;
    if (this.dragging) { const id = this.dragging; this.dragging = null; this.cb.dragEnd(id, -1, -1); }
  }

  private move = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.dragging) {
      this.cb.dragMove(this.dragging, e.clientX, e.clientY);
      return;
    }
    const tc = this.tokenCand, sc = this.slotCand;
    const origin = tc ?? sc;
    if (origin && Math.hypot(e.clientX - origin.sx, e.clientY - origin.sy) > MOVE_PX) {
      if (tc && !tc.touch) {
        // souris : glisser directement un jeton
        clearTimeout(tc.timer);
        this.dragging = tc.id;
        this.cb.dragStart(tc.id);
        this.cb.dragMove(tc.id, e.clientX, e.clientY);
        return;
      }
      this.moved = true;
      this.cancelCandidates();
    }
    if (this.ptrs.size === 2 && this.pinch) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.zoomAt(clamp(this.pinch.zoom * d / this.pinch.d, 0.05, 3), mx, my);
      this.panBy(dx / 2, dy / 2);
      this.moved = true;
      return;
    }
    if (this.ptrs.size === 1 && !tc && !sc || (this.moved && this.ptrs.size === 1)) {
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        this.panBy(dx, dy);
        const now = performance.now(), dt = Math.max(1, now - this.last.t);
        this.vel.x = 0.8 * this.vel.x + 0.2 * (dx / dt * 16);
        this.vel.y = 0.8 * this.vel.y + 0.2 * (dy / dt * 16);
        this.last = { x: e.clientX, y: e.clientY, t: now };
        this.moved = true;
      }
    }
  };

  private up = (e: PointerEvent) => {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    const tc = this.tokenCand, sc = this.slotCand;
    if (this.dragging) {
      const id = this.dragging; this.dragging = null;
      clearTimeout(tc?.timer);
      this.tokenCand = null;
      this.cb.dragEnd(id, e.clientX, e.clientY);
    } else if (tc && tc.pid === e.pointerId) {
      clearTimeout(tc.timer);
      this.tokenCand = null;
      if (!this.moved && e.type === 'pointerup') this.cb.tapToken(tc.id);
    } else if (sc && !this.moved && e.type === 'pointerup') {
      this.slotCand = null;
      this.cb.tapSlot(sc.id);
    }
    this.slotCand = null;
    if (this.ptrs.size < 2) this.pinch = null;
    if (this.ptrs.size === 0) {
      this.active = false;
      if (this.moved && performance.now() - this.last.t < 90 && Math.hypot(this.vel.x, this.vel.y) > 1.2) this.inertia();
    }
  };

  private inertia() {
    const step = () => {
      this.vel.x *= 0.93; this.vel.y *= 0.93;
      if (Math.hypot(this.vel.x, this.vel.y) < 0.12) { this.anim = null; return; }
      this.panBy(this.vel.x, this.vel.y);
      this.anim = { raf: requestAnimationFrame(step) };
    };
    this.anim = { raf: requestAnimationFrame(step) };
  }

  private wheel = (e: WheelEvent) => {
    if (!this.cb.enabled()) return;
    e.preventDefault();
    this.stopMotion();
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
    this.zoomAt(this.cam.zoom * k, e.clientX, e.clientY);
  };
  private dbl = (e: MouseEvent) => {
    if (!this.cb.enabled()) return;
    if ((e.target as HTMLElement).closest('.token,.slot-free')) return;
    this.flyTo({ ...this.toWorld(e.clientX, e.clientY), zoom: this.cam.zoom * 1.8 }, 450);
  };

  panBy(dx: number, dy: number) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.cb.clamp(this.cam);
    this.cb.changed();
  }
  zoomAt(z: number, cx: number, cy: number) {
    const before = this.toWorld(cx, cy);
    this.cam.zoom = z;
    this.cb.clamp(this.cam);
    const after = this.toWorld(cx, cy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.cb.clamp(this.cam);
    this.cb.changed();
  }

  flyTo(t: { x: number; y: number; zoom?: number }, ms = 900, done?: () => void) {
    this.stopMotion();
    const from = { ...this.cam };
    const toZoom = t.zoom ?? this.cam.zoom;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = clamp((now - t0) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      // zoom interpolé en logarithmique pour un mouvement naturel
      this.cam.zoom = Math.exp(Math.log(from.zoom) * (1 - e) + Math.log(toZoom) * e);
      this.cam.x = from.x + (t.x - from.x) * e;
      this.cam.y = from.y + (t.y - from.y) * e;
      this.cb.clamp(this.cam);
      this.cb.changed();
      if (k < 1) this.flyRaf = requestAnimationFrame(step); else { this.flyRaf = 0; done?.(); }
    };
    this.flyRaf = requestAnimationFrame(step);
  }
}

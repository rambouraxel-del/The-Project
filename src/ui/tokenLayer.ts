// Couche des jetons posés sur la carte : positionnement monde → écran, glisser-déposer vers les emplacements.
import type { Store } from '../store';
import { gstate } from '../store';
import type { Camera } from '../world/renderer';
import type { WorldRenderer } from '../world/renderer';
import { slotUnlocked } from '../world/worldgen';
import { buildToken, updateToken } from './tokenEl';
import { icon } from './icons';

const TOK_WORLD = 175;

export class TokenLayer {
  private toks = new Map<string, HTMLElement>();
  private slotEls = new Map<number, HTMLElement>();
  private held = new Set<string>();
  holdNext = false;
  private drag: { id: string; slot: number | null; x: number; y: number } | null = null;
  private settling = new Set<string>();
  size = 60;

  constructor(private tokensEl: HTMLElement, private slotsEl: HTMLElement, private store: Store, private view: () => { w: number; h: number }) {}

  tokenEl(id: string) { return this.toks.get(id) ?? null; }
  setHidden(id: string, hidden: boolean) { this.toks.get(id)?.classList.toggle('hidden', hidden); }

  sync(renderer: WorldRenderer | null) {
    const goals = this.store.mapGoals().filter(g => g.slot != null);
    const alive = new Set(goals.map(g => g.id));
    for (const [id, el] of this.toks) if (!alive.has(id)) { el.remove(); this.toks.delete(id); this.held.delete(id); }
    for (const g of goals) {
      let el = this.toks.get(g.id);
      if (!el) {
        el = buildToken(g, { size: 70, label: true });
        this.tokensEl.appendChild(el);
        this.toks.set(g.id, el);
        if (this.holdNext) { el.classList.add('hidden'); this.held.add(g.id); }
      } else updateToken(el, g);
      (el as any)._slot = g.slot;
    }
    this.holdNext = false;
    // emplacements libres
    const free = new Set(this.store.freeSlots());
    for (const [id, el] of this.slotEls) if (!free.has(id)) { el.remove(); this.slotEls.delete(id); }
    for (const id of free) {
      if (this.slotEls.has(id)) continue;
      const el = document.createElement('div');
      el.className = 'slot-free';
      el.dataset.slot = String(id);
      el.innerHTML = `<span class="plus">${icon.plus}</span>`;
      el.setAttribute('aria-label', 'Emplacement libre : créer un objectif');
      this.slotsEl.appendChild(el);
      this.slotEls.set(id, el);
    }
    void renderer;
  }

  release(id: string) {
    const el = this.toks.get(id);
    if (!el) return;
    this.held.delete(id);
    el.classList.remove('hidden');
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 1000);
  }
  isHeld(id: string) { return this.held.has(id); }

  /** Positionne tous les éléments selon la caméra. */
  layout(cam: Camera, renderer: WorldRenderer) {
    const { w, h } = this.view();
    const ts = Math.max(46, Math.min(108, cam.zoom * TOK_WORLD));
    this.size = ts;
    const world = this.store.world;
    const labelsOn = cam.zoom > 0.24;
    const tx = (x: number) => (x - cam.x) * cam.zoom + w / 2;
    const ty = (y: number) => (y - cam.y) * cam.zoom + h / 2;
    for (const [id, el] of this.toks) {
      const slot = this.drag?.id === id ? null : (el as any)._slot as number | null;
      el.style.setProperty('--s', ts + 'px');
      el.classList.toggle('nolabel', !labelsOn);
      (el.querySelector('.label') as HTMLElement | null)?.style.setProperty('display', labelsOn ? '' : 'none');
      let x: number, y: number;
      if (this.drag?.id === id) { x = this.drag.x; y = this.drag.y; }
      else {
        const s = world.slots[slot ?? (el as any)._slot];
        if (!s) continue;
        const sx = tx(s.x), sy = ty(s.y);
        if (sx < -ts * 2 || sx > w + ts * 2 || sy < -ts * 2 || sy > h + ts * 2) { el.style.display = 'none'; continue; }
        x = sx; y = sy - ts * 0.04;
      }
      el.style.display = '';
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      el.style.zIndex = String(Math.round(y));
    }
    for (const [id, el] of this.slotEls) {
      const s = world.slots[id];
      const sx = tx(s.x), sy = ty(s.y);
      const vis = sx > -ts && sx < w + ts && sy > -ts && sy < h + ts && renderer.revealAt(s.x, s.y) > 0.7;
      el.style.display = vis ? '' : 'none';
      if (!vis) continue;
      el.style.setProperty('--s', ts * 0.92 + 'px');
      el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
    }
  }

  // ---- glisser-déposer ----
  dragStart(id: string, cam: Camera): void {
    const el = this.toks.get(id);
    if (!el) return;
    el.classList.add('lift');
    const s = this.store.world.slots[(el as any)._slot];
    const { w, h } = this.view();
    this.drag = { id, slot: (el as any)._slot, x: (s.x - cam.x) * cam.zoom + w / 2, y: (s.y - cam.y) * cam.zoom + h / 2 };
    for (const el2 of this.slotEls.values()) el2.classList.add('hot-ready');
  }
  dragMove(id: string, cx: number, cy: number, cam: Camera, stageRect: DOMRect) {
    if (!this.drag || this.drag.id !== id) return;
    this.drag.x = cx - stageRect.left; this.drag.y = cy - stageRect.top - this.size * 0.3;
    // emplacement le plus proche
    const wx = cam.x + (this.drag.x - stageRect.width / 2) / cam.zoom, wy = cam.y + (this.drag.y + this.size * 0.0 - stageRect.height / 2) / cam.zoom;
    const best = this.nearestSlot(wx, wy, id);
    this.drag.slot = best;
    for (const [sid, el] of this.slotEls) el.classList.toggle('hot', sid === best);
  }
  private nearestSlot(wx: number, wy: number, selfId: string): number | null {
    const used = this.store.usedSlots(selfId);
    const own = this.store.find(selfId)?.goal.slot;
    let best: number | null = null, bd = 230;
    for (const s of this.store.world.slots) {
      if (used.has(s.id) || !slotUnlocked(s, this.store.lobes)) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < bd) { bd = d; best = s.id; }
    }
    return best ?? (own ?? null);
  }
  dragEnd(id: string, cancelled: boolean): number | null {
    const el = this.toks.get(id);
    const d = this.drag;
    this.drag = null;
    el?.classList.remove('lift');
    for (const el2 of this.slotEls.values()) el2.classList.remove('hot', 'hot-ready');
    if (!d || cancelled) return null;
    return d.slot;
  }
  isDragging() { return this.drag !== null; }
  /** Fait glisser doucement le jeton vers son emplacement. */
  settle(id: string) {
    const el = this.toks.get(id);
    if (!el) return;
    el.style.transition = 'transform .38s cubic-bezier(.2,.9,.3,1.1)';
    this.settling.add(id);
    setTimeout(() => { el.style.transition = ''; this.settling.delete(id); }, 420);
  }
  stateOf(id: string) { const f = this.store.find(id); return f ? gstate(f.goal) : 'active'; }
}

// Cadran de sous-objectifs : cercle puis anneaux concentriques, hiérarchie illimitée.
import type { Goal, Store } from '../store';
import { gstate, progress } from '../store';
import { buildToken, updateToken } from './tokenEl';
import { icon } from './icons';
import { esc } from './modals';

export interface DialHost {
  store: Store;
  layer: HTMLElement;
  sheet: HTMLElement;
  topInset(): number;
  tokenRect(id: string): DOMRect | null;
  onOpen(rootId: string): void;
  onClosed(rootId: string): void;
  addChild(parentId: string): void;
  edit(id: string): void;
  list(id: string): void;
  /** valide ou rouvre ; renvoie true si effectué. `el` = jeton central pour l'animation */
  toggleDone(id: string, el: HTMLElement | null, quick: boolean): Promise<boolean> | boolean;
  askDelete(id: string): Promise<boolean>;
}

interface Layout { ts: number; cs: number; rings: { r: number; count: number }[]; labels: boolean; outer: number }

const CHK = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 12.5l4.5 4.5L19 7.5'/></svg>")`;

export function computeLayout(n: number, availR: number): Layout {
  const cs = Math.min(112, Math.max(66, availR * 0.36));
  const start = Math.round(Math.max(44, Math.min(92, availR * 0.34)) / 2) * 2;
  // 1) petit nombre d'éléments : un seul cercle, avec les noms lisibles
  if (n <= 8) {
    for (let ts = start; ts >= 50; ts -= 2) {
      const r = Math.max(cs / 2 + ts * 0.66 + 24, (n * 112) / (2 * Math.PI));
      if (r + ts * 0.75 + 26 <= availR) return { ts, cs, rings: [{ r, count: n }], labels: true, outer: r };
    }
  }
  // 2) beaucoup d'éléments : anneaux concentriques, noms au toucher
  let best: Layout | null = null;
  for (let ts = start; ts >= 28; ts -= 2) {
    const gap = ts * 1.1 + 4;
    const r1 = cs / 2 + ts * 0.66 + 10;
    const rings: { r: number; count: number }[] = [];
    let left = n, k = 0;
    while (left > 0 && k < 12) {
      const r = r1 + k * gap;
      const cap = Math.max(3, Math.floor((2 * Math.PI * r) / (ts * 1.1 + 3)));
      const take = Math.min(left, cap);
      rings.push({ r, count: take });
      left -= take; k++;
    }
    const outer = rings.length ? rings[rings.length - 1].r : r1;
    best = { ts, cs, rings, labels: false, outer };
    if (left === 0 && outer + ts * 0.75 + 6 <= availR) return best;
  }
  return best!;
}

export class Dial {
  stack: string[] = [];
  private cx = 0; private cy = 0; private plateR = 0;
  private rootEl: HTMLElement | null = null;
  private building = false;
  private renderedAt = 0;
  private childIds: string[] = [];
  private tip: HTMLElement | null = null;
  readonly isOpen = () => this.stack.length > 0;

  constructor(private h: DialHost) {
    h.layer.addEventListener('click', this.onClick);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.isOpen() && !document.querySelector('.modal')) this.up(); });
    window.addEventListener('resize', () => { if (this.isOpen()) this.render(false, null); });
  }

  get currentId() { return this.stack[this.stack.length - 1]; }
  get rootId() { return this.stack[0]; }

  open(rootId: string) {
    const rect = this.h.tokenRect(rootId);
    this.stack = [rootId];
    document.body.classList.add('dial-open');
    this.h.layer.classList.add('on');
    this.h.onOpen(rootId);
    this.render(true, rect);
  }

  /** Ouvre directement un nœud profond (liste, archives). */
  openPath(ids: string[]) {
    this.stack = ids;
    document.body.classList.add('dial-open');
    this.h.layer.classList.add('on');
    this.h.onOpen(ids[0]);
    this.render(true, null);
  }

  drill(id: string, rect: DOMRect | null) {
    this.stack.push(id);
    this.render(true, rect);
  }

  up() {
    if (!this.isOpen() || this.building) return;
    if (this.stack.length === 1) { this.close(); return; }
    this.stack.pop();
    this.render(true, null);
  }

  goTo(depth: number) {
    if (depth >= this.stack.length - 1) return;
    this.stack.length = depth + 1;
    this.render(true, null);
  }

  close(instant = false) {
    const rid = this.stack[0];
    if (!rid) return;
    const centerEl = this.rootEl?.querySelector('.dial-center') as HTMLElement | null;
    const target = this.stack.length === 1 ? this.h.tokenRect(rid) : null;
    this.stack = [];
    document.body.classList.remove('dial-open');
    this.h.sheet.classList.remove('on');
    const root = this.rootEl;
    this.h.layer.classList.remove('on');
    if (root) {
      root.classList.add('dial-layer-out');
      root.querySelector('.plate')?.classList.remove('in');
      root.querySelectorAll('.ringline').forEach(r => r.classList.remove('in'));
      if (centerEl && target && !instant) {
        const kx = target.left + target.width / 2 - this.cx, ky = target.top + target.height / 2 - this.cy;
        const sz = parseFloat(centerEl.querySelector<HTMLElement>('.token')!.style.getPropertyValue('--s'));
        centerEl.style.transition = 'transform .5s cubic-bezier(.3,.8,.2,1)';
        centerEl.style.transform = `translate(${kx}px, ${ky}px) scale(${target.width / sz})`;
      } else if (centerEl) { centerEl.style.transition = 'opacity .3s'; centerEl.style.opacity = '0'; }
    }
    setTimeout(() => {
      if (this.rootEl === root) { this.h.layer.innerHTML = ''; this.rootEl = null; }
      this.h.onClosed(rid);
    }, instant ? 0 : 520);
  }

  /** Mise à jour douce après un changement du modèle. */
  refresh() {
    if (!this.isOpen()) return;
    const f = this.h.store.find(this.currentId);
    if (!f) { // l'élément courant a disparu
      this.stack = this.stack.filter(id => this.h.store.find(id));
      if (!this.stack.length) { this.close(true); return; }
      this.render(false, null); return;
    }
    const ids = f.goal.children.map(c => c.id).join(',');
    if (ids !== this.childIds.join(',') || !this.rootEl) { this.render(false, null); return; }
    this.softUpdate();
  }

  private softUpdate() {
    const f = this.h.store.find(this.currentId)!;
    const root = this.rootEl!;
    const center = root.querySelector('.dial-center .token') as HTMLElement | null;
    if (center) updateToken(center, f.goal, f.inactive);
    for (const c of f.goal.children) {
      const el = root.querySelector(`.dial-item .token[data-id="${c.id}"]`) as HTMLElement | null;
      if (el) { updateToken(el, c, f.inactive || !!f.goal.inactive); this.badge(el, c); }
    }
    this.renderSheet();
  }

  private badge(el: HTMLElement, c: Goal) {
    const q = el.querySelector('.qv') as HTMLElement | null;
    const st = gstate(c);
    const show = c.children.length === 0 || st === 'ready' || st === 'done' && c.children.length === 0;
    if (q) q.style.display = show ? '' : 'none';
  }

  // ------------------------------------------------------------
  private render(intro: boolean, fromRect: DOMRect | null) {
    const store = this.h.store;
    const f = store.find(this.currentId);
    if (!f) return;
    const g = f.goal;
    const inactive = f.inactive || !!g.inactive;
    this.childIds = g.children.map(c => c.id);
    const vw = window.innerWidth, vh = window.innerHeight;

    this.renderSheet();
    const sheetH = this.h.sheet.offsetHeight || 190;
    const top = this.h.topInset() + 54;
    const bottom = vh - sheetH - 10;
    this.cx = vw / 2;
    this.cy = top + (bottom - top) / 2;
    const availR = Math.max(110, Math.min(vw / 2 - 6, (bottom - top) / 2 - 2));
    const canAdd = !g.done;
    const n = g.children.length + (canAdd ? 1 : 0);
    const L = computeLayout(n, availR);
    this.plateR = (L.rings.length ? L.outer : L.cs) + L.ts * 0.8 + 8 + (L.labels ? 18 : 0);
    if (!L.rings.length) this.plateR = L.cs / 2 + L.ts * 1.35;

    const old = this.rootEl;
    if (old) {
      old.style.pointerEvents = 'none';
      old.classList.add('dial-layer-out');
      old.querySelector('.plate')?.classList.remove('in');
      setTimeout(() => old.remove(), 380);
    }
    const layer = this.h.layer;
    if (!layer.querySelector('.dial-backdrop')) {
      const bd = document.createElement('div');
      bd.className = 'dial-backdrop';
      layer.appendChild(bd);
    }
    (layer.querySelector('.dial-backdrop') as HTMLElement).style.cssText = `--cx:${this.cx}px;--cy:${this.cy}px`;

    const root = document.createElement('div');
    root.className = 'dial-root';
    root.style.cssText = `--cx:${this.cx}px;--cy:${this.cy}px`;
    const hub = L.cs / 2 + 7;
    root.innerHTML = `<div class="plate" style="width:${this.plateR * 2}px;height:${this.plateR * 2}px;--hub:${hub}px"></div>`;
    L.rings.forEach(r => {
      const rl = document.createElement('div');
      rl.className = 'ringline';
      rl.style.width = rl.style.height = r.r * 2 + 'px';
      root.appendChild(rl);
    });

    // jeton central
    const centerWrap = document.createElement('div');
    centerWrap.className = 'dial-center';
    const ctok = buildToken(g, { size: L.cs, inactiveAncestor: f.inactive });
    ctok.style.pointerEvents = 'auto';
    centerWrap.appendChild(ctok);
    root.appendChild(centerWrap);

    // éléments du cadran
    const items: HTMLElement[] = [];
    let idx = 0;
    const all: (Goal | null)[] = [...g.children, ...(canAdd ? [null] : [])];
    L.rings.forEach((ring, k) => {
      const ringEl = document.createElement('div');
      ringEl.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
      const off = k % 2 ? 0.5 : 0;
      for (let i = 0; i < ring.count; i++) {
        const child = all[idx++];
        const ang = -Math.PI / 2 + ((i + off) / ring.count) * Math.PI * 2;
        const x = Math.cos(ang) * ring.r, y = Math.sin(ang) * ring.r;
        const item = document.createElement('div');
        item.className = 'dial-item';
        item.dataset.x = String(x); item.dataset.y = String(y);
        item.style.transform = intro ? 'translate(0px,0px) scale(.3)' : `translate(${x}px,${y}px)`;
        const counter = document.createElement('div');
        counter.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
        counter.className = 'counter';
        if (child) {
          const tok = buildToken(child, { size: L.ts, inactiveAncestor: inactive, label: L.labels, badge: true });
          tok.querySelector('.qv')!.setAttribute('style', `--chk:${CHK}`);
          this.badge(tok, child);
          counter.appendChild(tok);
        } else {
          const add = document.createElement('button');
          add.className = 'add-socket';
          add.dataset.add = '1';
          add.style.setProperty('--s', L.ts + 'px');
          add.innerHTML = icon.plus;
          add.setAttribute('aria-label', 'Ajouter un sous-objectif');
          counter.appendChild(add);
        }
        item.appendChild(counter);
        ringEl.appendChild(item);
        items.push(item);
      }
      root.appendChild(ringEl);
      (ringEl as any)._ring = k;
    });
    layer.appendChild(root);
    this.rootEl = root;

    const plate = root.querySelector('.plate') as HTMLElement;
    const lines = root.querySelectorAll('.ringline');
    if (intro) {
      // jeton central : part de son emplacement précédent (FLIP)
      if (fromRect) {
        const kx = fromRect.left + fromRect.width / 2 - this.cx, ky = fromRect.top + fromRect.height / 2 - this.cy;
        centerWrap.style.transform = `translate(${kx}px, ${ky}px) scale(${fromRect.width / L.cs})`;
        centerWrap.getBoundingClientRect();
        centerWrap.style.transition = 'transform .6s cubic-bezier(.2,.9,.25,1.08)';
        requestAnimationFrame(() => { centerWrap.style.transform = ''; });
      } else {
        centerWrap.style.opacity = '0'; centerWrap.style.transform = 'scale(.6)';
        centerWrap.getBoundingClientRect();
        centerWrap.style.transition = 'transform .5s cubic-bezier(.2,.9,.3,1.2), opacity .3s';
        requestAnimationFrame(() => { centerWrap.style.transform = ''; centerWrap.style.opacity = '1'; });
      }
      requestAnimationFrame(() => {
        plate.classList.add('in');
        lines.forEach((l, i) => setTimeout(() => l.classList.add('in'), 90 + i * 70));
        items.forEach((it, i) => {
          const ring = Math.max(0, L.rings.findIndex((r, k) => items.indexOf(it) < L.rings.slice(0, k + 1).reduce((a, b) => a + b.count, 0)));
          setTimeout(() => {
            it.style.transform = `translate(${it.dataset.x}px,${it.dataset.y}px)`;
            it.classList.add('in');
          }, 140 + ring * 90 + i * 22);
        });
        // effet « cadran téléphonique » : chaque anneau tourne en arrivant
        root.querySelectorAll<HTMLElement>(':scope > div').forEach(el => {
          const k = (el as any)._ring;
          if (k === undefined) return;
          const dir = k % 2 ? 1 : -1;
          const from = dir * (110 + k * 25);
          el.animate([{ transform: `rotate(${from}deg)` }, { transform: 'rotate(0deg)' }], { duration: 820 + k * 90, delay: 120 + k * 70, easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' });
          el.querySelectorAll<HTMLElement>('.counter').forEach(c => c.animate([{ transform: `rotate(${-from}deg)` }, { transform: 'rotate(0deg)' }], { duration: 820 + k * 90, delay: 120 + k * 70, easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' }));
        });
      });
    } else {
      plate.classList.add('in');
      lines.forEach(l => l.classList.add('in'));
      items.forEach(it => it.classList.add('in'));
    }
    this.renderedAt = intro ? performance.now() : this.renderedAt;
    this.building = true;
    setTimeout(() => (this.building = false), intro ? 450 : 0);
    requestAnimationFrame(() => this.h.sheet.classList.add('on'));
  }

  // ------------------------------------------------------------
  private onClick = async (e: MouseEvent) => {
    if (!this.isOpen() || performance.now() - this.renderedAt < 380) return; // évite le clic fantôme après un toucher
    const t = e.target as HTMLElement;
    this.hideTip();
    const add = t.closest('[data-add]');
    if (add) { this.h.addChild(this.currentId); return; }
    const qv = t.closest('.qv') as HTMLElement | null;
    if (qv) {
      const tok = qv.closest('.token') as HTMLElement;
      await this.h.toggleDone(tok.dataset.id!, tok, true);
      return;
    }
    const tok = t.closest('.token') as HTMLElement | null;
    if (tok && tok.dataset.id) {
      if (tok.closest('.dial-center')) return;
      this.drill(tok.dataset.id, tok.getBoundingClientRect());
      return;
    }
    // clic dans le vide : à l'extérieur du cadran → niveau précédent
    const d = Math.hypot(e.clientX - this.cx, e.clientY - this.cy);
    if (d > this.plateR + 4) this.up();
  };

  private hideTip() { this.tip?.remove(); this.tip = null; }
  showTip(el: HTMLElement, text: string) {
    this.hideTip();
    const r = el.getBoundingClientRect();
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.textContent = text;
    tip.style.left = Math.min(window.innerWidth - 60, Math.max(60, r.left + r.width / 2)) + 'px';
    tip.style.top = r.top - 6 + 'px';
    this.h.layer.parentElement!.appendChild(tip);
    this.tip = tip;
    setTimeout(() => { if (this.tip === tip) this.hideTip(); }, 2200);
  }
  bindTips() {
    // survol (souris) et appui long (tactile) : nom du sous-objectif
    const layer = this.h.layer;
    let timer = 0;
    layer.addEventListener('pointerover', e => {
      if ((e as PointerEvent).pointerType !== 'mouse') return;
      const tok = (e.target as HTMLElement).closest('.dial-item .token') as HTMLElement | null;
      if (tok) { const f = this.h.store.find(tok.dataset.id!); if (f) this.showTip(tok, f.goal.title); }
    });
    layer.addEventListener('pointerout', e => { if ((e as PointerEvent).pointerType === 'mouse') this.hideTip(); });
    layer.addEventListener('pointerdown', e => {
      const tok = (e.target as HTMLElement).closest('.dial-item .token') as HTMLElement | null;
      if (!tok || (e as PointerEvent).pointerType === 'mouse') return;
      timer = window.setTimeout(() => { const f = this.h.store.find(tok.dataset.id!); if (f) this.showTip(tok, f.goal.title); }, 380);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointermove']) layer.addEventListener(ev, () => clearTimeout(timer));
  }

  // ------------------------------------------------------------
  private renderSheet() {
    const store = this.h.store;
    const f = store.find(this.currentId);
    if (!f) return;
    const g = f.goal;
    const st = gstate(g, f.inactive);
    const p = progress(g);
    const crumbs = this.stack.map((id, i) => {
      const x = store.find(id)!.goal;
      return `<button data-crumb="${i}">${esc(x.title)}</button>`;
    }).join('<i>›</i>');
    const chipLabel = { inactive: 'En sommeil', active: 'Actif', ready: 'Prêt à valider', done: 'Accompli' }[st];
    const isRoot = !f.parent;
    const remaining = g.children.filter(c => !c.done).length;
    let primary = '';
    if (st === 'done') primary = `<button class="btn primary" data-act="reopen">${icon.undo}<span>Rouvrir</span></button>`;
    else if (g.children.length === 0 || st === 'ready') primary = `<button class="btn primary" data-act="done" ${st === 'inactive' ? 'disabled' : ''}>${icon.check}<span>${isRoot ? 'Sceller l’objectif' : g.children.length ? 'Valider l’objectif' : 'Accomplir'}</span></button>`;
    else primary = `<button class="btn primary" data-act="done" disabled>${icon.check}<span>${remaining} restant${remaining > 1 ? 's' : ''}</span></button>`;
    const hint = st === 'inactive' ? 'Ce jeton est en sommeil : réveillez-le pour pouvoir le valider.'
      : st === 'active' && g.children.length ? 'Accomplissez les sous-objectifs, puis validez ce jeton.'
      : st === 'ready' ? 'Tous les sous-objectifs sont accomplis. Il ne reste qu’à valider.' : '';
    const sheet = this.h.sheet;
    sheet.innerHTML = `<div class="sheet-card">
      ${this.stack.length > 1 ? `<div class="crumbs">${crumbs}</div>` : ''}
      <div class="sheet-head"><h2 class="sheet-title">${esc(g.title)}</h2><span class="chip ${st}">${chipLabel}</span></div>
      ${g.note ? `<p class="sheet-note">${esc(g.note)}</p>` : ''}
      ${g.children.length ? `<div class="prog"><div class="bar"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></div><span>${p.done}/${p.total} tâches</span></div>` : '<div style="height:10px"></div>'}
      <div class="actions">
        ${primary}
        ${st !== 'done' ? `<button class="btn" data-act="add">${icon.plus}<span>Sous-objectif</span></button>` : ''}
        ${g.children.length ? `<button class="btn icon" data-act="list" aria-label="Liste">${icon.list}</button>` : ''}
        <button class="btn icon" data-act="edit" aria-label="Modifier">${icon.edit}</button>
        ${st !== 'done' ? `<button class="btn icon" data-act="sleep" aria-label="${g.inactive ? 'Réveiller' : 'Mettre en sommeil'}">${g.inactive ? icon.sun : icon.moon}</button>` : ''}
        <button class="btn icon danger" data-act="del" aria-label="Supprimer">${icon.trash}</button>
      </div>
      ${hint ? `<p class="hint">${hint}</p>` : ''}
    </div>`;
  }

  bindSheet() {
    this.h.sheet.addEventListener('click', async e => {
      const t = e.target as HTMLElement;
      const crumb = t.closest('[data-crumb]') as HTMLElement | null;
      if (crumb) { const d = +crumb.dataset.crumb!; if (d === this.stack.length - 1) return; if (d === 0 && false) return; this.goTo(d); return; }
      const b = t.closest('[data-act]') as HTMLElement | null;
      if (!b || b.hasAttribute('disabled')) return;
      const id = this.currentId, store = this.h.store;
      const centerTok = this.rootEl?.querySelector('.dial-center .token') as HTMLElement | null;
      switch (b.dataset.act) {
        case 'done': {
          const isRoot = this.stack.length === 1;
          const ok = await this.h.toggleDone(id, centerTok, false);
          if (ok && !isRoot) setTimeout(() => this.up(), 650);
          break;
        }
        case 'reopen': await this.h.toggleDone(id, centerTok, false); break;
        case 'add': this.h.addChild(id); break;
        case 'list': this.h.list(id); break;
        case 'edit': this.h.edit(id); break;
        case 'sleep': { const f = store.find(id)!; store.setInactive(id, !f.goal.inactive); break; }
        case 'del': {
          if (await this.h.askDelete(id)) {
            const wasRoot = this.stack.length === 1;
            store.remove(id);
            if (wasRoot) this.close(true); else { this.stack.pop(); this.render(false, null); }
          }
          break;
        }
      }
    });
  }
}

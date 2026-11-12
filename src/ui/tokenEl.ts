import type { Goal, GState } from '../store';
import { gstate, progress } from '../store';

export const BASE = import.meta.env.BASE_URL;
export const tokenSrc = (g: { material: string; emblem: string }) => `${BASE}assets/tok/${g.material}_${g.emblem}.webp`;

const CIRC = 2 * Math.PI * 47;

export interface TokenOpts {
  size: number;          // px
  state?: GState;        // sinon calculé
  inactiveAncestor?: boolean;
  label?: boolean;
  badge?: boolean;       // pastille de validation rapide
}

/** Construit le DOM d'un jeton (carte ou cadran) : matériau, aura, anneau de progression, sceau. */
export function buildToken(g: Goal, o: TokenOpts): HTMLElement {
  const st = o.state ?? gstate(g, o.inactiveAncestor);
  const el = document.createElement('div');
  el.className = `token st-${st}`;
  el.dataset.id = g.id;
  el.style.setProperty('--s', o.size + 'px');
  el.innerHTML = `
    <div class="aura"></div>
    <div class="shadow"></div>
    <div class="body"><img src="${tokenSrc(g)}" alt="" draggable="false"></div>
    <svg class="ring" viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="47"/><circle class="ring-fg" cx="50" cy="50" r="47" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/></svg>
    <div class="seal"></div>
    ${o.label ? `<div class="label"><span></span></div>` : ''}
    ${o.badge ? `<button class="qv" type="button" aria-label="Valider"></button>` : ''}`;
  if (o.label) (el.querySelector('.label span') as HTMLElement).textContent = g.title;
  updateToken(el, g, o.inactiveAncestor);
  return el;
}

export function updateToken(el: HTMLElement, g: Goal, inactiveAncestor = false) {
  const st = gstate(g, inactiveAncestor);
  el.className = el.className.replace(/st-\w+/, 'st-' + st);
  const p = progress(g);
  const frac = g.children.length ? p.done / p.total : (g.done ? 1 : 0);
  const fg = el.querySelector('.ring-fg') as SVGElement | null;
  if (fg) fg.setAttribute('stroke-dashoffset', String(CIRC * (1 - (st === 'ready' || st === 'done' ? 1 : frac))));
  const img = el.querySelector('img') as HTMLImageElement | null;
  const src = tokenSrc(g);
  if (img && !img.src.endsWith(src.replace('./', ''))) img.src = src;
  const lab = el.querySelector('.label span');
  if (lab && lab.textContent !== g.title) lab.textContent = g.title;
}

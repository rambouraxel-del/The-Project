import type { Goal, Store, Emblem, Material } from '../store';
import { EMBLEMS, MATERIALS, gstate, progress, countTasks } from '../store';
import { icon } from './icons';
import { BASE, tokenSrc } from './tokenEl';

const root = () => document.getElementById('modal-root')!;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface ModalHandle { el: HTMLElement; body: HTMLElement; close(): void }

export function openModal(title: string, opts: { onClose?: () => void } = {}): ModalHandle {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="card" role="dialog" aria-modal="true"><div class="card-head"><h2></h2><button class="mini close" aria-label="Fermer">${icon.close}</button></div><div class="card-body"></div></div>`;
  (m.querySelector('h2') as HTMLElement).textContent = title;
  root().appendChild(m);
  requestAnimationFrame(() => m.classList.add('on'));
  const h: ModalHandle = {
    el: m, body: m.querySelector('.card-body') as HTMLElement,
    close() { m.classList.remove('on'); setTimeout(() => m.remove(), 350); opts.onClose?.(); document.removeEventListener('keydown', onKey); },
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') h.close(); };
  document.addEventListener('keydown', onKey);
  m.addEventListener('pointerdown', e => { if (e.target === m) h.close(); });
  m.querySelector('.close')!.addEventListener('click', () => h.close());
  return h;
}

export function confirmBox(title: string, text: string, okLabel: string): Promise<boolean> {
  return new Promise(res => {
    let decided = false;
    const m = openModal(title, { onClose: () => { if (!decided) res(false); } });
    m.body.innerHTML = `<p class="hint" style="margin:0 0 14px;font-size:17px">${esc(text)}</p><div class="card-foot"><button class="btn" data-a="no" style="flex:1">Annuler</button><button class="btn danger" data-a="ok" style="flex:1">${esc(okLabel)}</button></div>`;
    m.body.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      decided = true; res(a === 'ok'); m.close();
    });
  });
}

export interface GoalForm { title: string; note: string; emblem: Emblem; material: Material }

/** Création / édition d'un objectif ou sous-objectif. */
export function goalModal(o: {
  heading: string; initial: GoalForm; submit: string; advancedOpen: boolean; continueLabel?: string;
  onSubmit: (f: GoalForm, again: boolean) => void;
}) {
  const m = openModal(o.heading);
  let { emblem, material } = o.initial;
  m.body.innerHTML = `
    <label class="field"><span>Intitulé</span><input id="f-title" type="text" maxlength="90" placeholder="Ex. : Courir un marathon" autocomplete="off" enterkeyhint="done"></label>
    <label class="field"><span>Note (facultatif)</span><textarea id="f-note" rows="2" maxlength="240" placeholder="Pourquoi ? Quand ? Comment ?"></textarea></label>
    <details class="adv" ${o.advancedOpen ? 'open' : ''}><summary>Apparence du jeton</summary>
      <div class="field"><span>Matière</span><div class="seg" id="f-mat">${MATERIALS.map(x => `<button type="button" data-m="${x.id}">${x.label}</button>`).join('')}</div></div>
      <div class="field"><span>Gravure</span><div class="picker" id="f-emb"></div></div>
    </details>
    <div class="card-foot">${o.continueLabel ? `<button class="btn" id="f-again" style="flex:1">${esc(o.continueLabel)}</button>` : ''}<button class="btn primary" id="f-ok" style="flex:1.4">${esc(o.submit)}</button></div>`;
  const title = m.body.querySelector('#f-title') as HTMLInputElement;
  const note = m.body.querySelector('#f-note') as HTMLTextAreaElement;
  title.value = o.initial.title; note.value = o.initial.note;
  const paint = () => {
    m.body.querySelectorAll('#f-mat button').forEach(b => b.classList.toggle('sel', (b as HTMLElement).dataset.m === material));
    const pk = m.body.querySelector('#f-emb')!;
    pk.innerHTML = EMBLEMS.map(e => `<button type="button" class="pick ${e.id === emblem ? 'sel' : ''}" data-e="${e.id}" title="${e.label}"><img src="${tokenSrc({ material, emblem: e.id })}" alt="${e.label}"></button>`).join('');
  };
  paint();
  m.body.addEventListener('click', ev => {
    const t = ev.target as HTMLElement;
    const mb = t.closest('[data-m]') as HTMLElement | null, eb = t.closest('[data-e]') as HTMLElement | null;
    if (mb) { material = mb.dataset.m as Material; paint(); }
    if (eb) { emblem = eb.dataset.e as Emblem; paint(); }
  });
  const submit = (again: boolean) => {
    const v = title.value.trim();
    if (!v) { title.focus(); title.style.borderColor = '#e07a6a'; return; }
    o.onSubmit({ title: v, note: note.value.trim(), emblem, material }, again);
    if (again) { title.value = ''; note.value = ''; title.focus(); } else m.close();
  };
  (m.body.querySelector('#f-ok') as HTMLElement).onclick = () => submit(false);
  const ag = m.body.querySelector('#f-again') as HTMLElement | null;
  if (ag) ag.onclick = () => submit(true);
  title.addEventListener('keydown', e => { if (e.key === 'Enter') submit(false); });
  setTimeout(() => title.focus(), 380);
  return m;
}

/** Arborescence modifiable d'un objectif (liste des sous-objectifs ou détail d'archive). */
export function treeRows(store: Store, g: Goal, depth: number, expanded: Set<string>, inactive = false): string {
  return g.children.map(c => {
    const st = gstate(c, inactive);
    const open = expanded.has(c.id);
    const kids = c.children.length;
    return `<div class="row ${st === 'done' ? 'is-done' : ''}" data-id="${c.id}">
      ${kids ? `<button class="exp" data-act="exp">${open ? '▾' : '▸'}</button>` : '<span style="width:24px"></span>'}
      <div class="tk"><img src="${tokenSrc(c)}" alt=""></div>
      <div class="tx"><b>${esc(c.title)}</b><small>${kids ? `${progress(c).done}/${progress(c).total} tâches` : st === 'done' ? 'Accompli' : st === 'inactive' ? 'En sommeil' : 'À faire'}</small></div>
      <div class="tools">
        ${kids === 0 || st === 'ready' || st === 'done' ? `<button class="mini ${c.done ? 'on' : ''}" data-act="toggle" title="${c.done ? 'Rouvrir' : 'Valider'}">${icon.check}</button>` : ''}
        <button class="mini" data-act="edit" title="Modifier">${icon.edit}</button>
        <button class="mini danger" data-act="del" title="Supprimer">${icon.trash}</button>
      </div></div>${open && kids ? `<div class="tree">${treeRows(store, c, depth + 1, expanded, inactive || !!c.inactive)}</div>` : ''}`;
  }).join('');
}

export function bindTree(m: ModalHandle, store: Store, rerender: () => void, ops: { edit(id: string): void; add?(id: string): void }, expanded: Set<string>) {
  m.body.addEventListener('click', async ev => {
    const t = ev.target as HTMLElement;
    const btn = t.closest('[data-act]') as HTMLElement | null;
    const row = t.closest('.row') as HTMLElement | null;
    if (!btn || !row) return;
    const id = row.dataset.id!;
    const act = btn.dataset.act;
    if (act === 'exp') { expanded.has(id) ? expanded.delete(id) : expanded.add(id); rerender(); }
    if (act === 'toggle') { const f = store.find(id); if (f) store.setDone(id, !f.goal.done); rerender(); }
    if (act === 'edit') ops.edit(id);
    if (act === 'del') { if (await confirmBox('Supprimer', 'Supprimer définitivement cet élément et tout son contenu ?', 'Supprimer')) { store.remove(id); rerender(); } }
  });
}

export function helpModal() {
  const m = openModal('Guide du voyageur');
  m.body.innerHTML = `
    <div class="rows" style="gap:10px">
      <div class="row"><div class="tx"><b>Explorer</b><small style="text-transform:none;letter-spacing:0;font:italic 500 15px var(--font-b)">Glissez pour vous déplacer, pincez (ou molette) pour zoomer. Double-tapez pour approcher.</small></div></div>
      <div class="row"><div class="tx"><b>Ouvrir un jeton</b><small style="text-transform:none;letter-spacing:0;font:italic 500 15px var(--font-b)">Touchez-le : ses sous-objectifs s’alignent en cadran. Touchez un sous-objectif pour descendre d’un niveau, l’extérieur du cadran pour remonter.</small></div></div>
      <div class="row"><div class="tx"><b>Déplacer un jeton</b><small style="text-transform:none;letter-spacing:0;font:italic 500 15px var(--font-b)">Appui long puis glissez vers un emplacement libre (cercle runique). Touchez un emplacement libre pour y créer un objectif.</small></div></div>
      <div class="row"><div class="tx"><b>États</b><small style="text-transform:none;letter-spacing:0;font:italic 500 15px var(--font-b)"><b style="display:inline;color:#9fb0cf">Inactif</b> : en sommeil, grisé · <b style="display:inline;color:#ffd88a">Actif</b> : lueur ambrée · <b style="display:inline;color:#ffe9a8">Prêt à valider</b> : tous les sous-objectifs sont faits, lueur dorée pulsée · <b style="display:inline;color:#f5d98a">Accompli</b> : doré, rejoint le reliquaire.</small></div></div>
      <div class="row"><div class="tx"><b>Reliquaire</b><small style="text-transform:none;letter-spacing:0;font:italic 500 15px var(--font-b)">Les objectifs principaux accomplis s’y accumulent. Touchez le tube pour consulter, modifier ou réactiver vos archives.</small></div></div>
    </div>`;
}
export { BASE, esc, countTasks };

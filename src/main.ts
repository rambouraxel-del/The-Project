import './styles.css';
import { generateWorld, WORLD_SIZE } from './world/worldgen';
import type { Lobe } from './world/worldgen';
import { WorldRenderer, loadAssets } from './world/renderer';
import type { Camera, Light, LobeAnim } from './world/renderer';
import { MapInput } from './world/camera';
import { Store, EMBLEMS, MATERIALS, gstate, countTasks } from './store';
import type { Goal, Emblem, Material } from './store';
import { TokenLayer } from './ui/tokenLayer';
import { Dial } from './ui/dial';
import { goalModal, openModal, confirmBox, treeRows, bindTree, helpModal, esc } from './ui/modals';
import { icon } from './ui/icons';
import { BASE, tokenSrc } from './ui/tokenEl';
import { clamp } from './world/noise';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function boot() {
  const loaderMsg = $('loader-msg'), loaderBar = $('loader-bar');
  const setP = (p: number, msg?: string) => { loaderBar.style.width = Math.round(p * 100) + '%'; if (msg) loaderMsg.textContent = msg; };
  setP(0.05, 'Gravure du monde…');
  await wait(30);
  const world = generateWorld(1337);
  setP(0.35, 'Éveil des terres…');
  const assets = await loadAssets(BASE, p => setP(0.35 + p * 0.6));
  // préchargement des jetons visibles dans les sélecteurs
  for (const m of MATERIALS) for (const e of EMBLEMS) { const i = new Image(); i.src = tokenSrc({ material: m.id, emblem: e.id }); }
  setP(0.97, 'Allumage des feux…');

  const store = new Store(world);
  const stage = $('stage');
  const canvas = $<HTMLCanvasElement>('gl'), decor = $<HTMLCanvasElement>('decor');
  const renderer = new WorldRenderer(canvas, decor, world, assets);
  const mobile = matchMedia('(pointer: coarse)').matches;
  let dprCap = mobile ? 1.6 : 2;
  const view = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  const doResize = () => {
    const { w, h } = view();
    renderer.resize(w, h, Math.min(window.devicePixelRatio || 1, dprCap));
    renderer.clampCam(cam);
    dirty = true;
  };

  // ---- territoire animé ----
  const lobeAnims: LobeAnim[] = store.lobes.map(l => ({ ...l, p: 1 }));
  renderer.setLobes(lobeAnims);
  const syncLobes = (animate: boolean): LobeAnim | null => {
    let added: LobeAnim | null = null;
    while (lobeAnims.length < store.lobes.length) {
      const l = store.lobes[lobeAnims.length];
      const a: LobeAnim = { ...l, p: animate ? 0 : 1 };
      lobeAnims.push(a); added = a;
    }
    if (lobeAnims.length > store.lobes.length) lobeAnims.length = store.lobes.length;
    renderer.setLobes(lobeAnims);
    return added;
  };
  const animateLobe = (a: LobeAnim, ms: number) => new Promise<void>(res => {
    const t0 = performance.now();
    const step = (now: number) => {
      const k = clamp((now - t0) / ms);
      a.p = 1 - Math.pow(1 - k, 3);
      renderer.revealDirty = true; dirty = true;
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });

  // ---- caméra ----
  const cam: Camera = { ...store.cam };
  const startZoom = () => clamp(window.innerWidth / 1300, 0.3, 0.6);
  if (!store.cam.zoom || store.cam.zoom <= 0 || !isFinite(store.cam.x)) { cam.x = world.hub.x; cam.y = world.hub.y; cam.zoom = startZoom(); }
  let dirty = true;
  let busy = false;

  const tokens = new TokenLayer($('tokens'), $('slots'), store, view);
  const input = new MapInput(stage, cam, {
    clamp: c => renderer.clampCam(c),
    changed: () => { dirty = true; },
    enabled: () => !busy && !dial.isOpen() && !document.querySelector('.modal'),
    tapToken: id => { if (!tokens.isHeld(id)) dial.open(id); },
    tapSlot: id => createRoot(id),
    dragStart: id => tokens.dragStart(id, cam),
    dragMove: (id, x, y) => { tokens.dragMove(id, x, y, cam, stage.getBoundingClientRect()); dirty = true; },
    dragEnd: (id, x, y) => {
      const slot = tokens.dragEnd(id, x < 0);
      if (slot != null && x >= 0) {
        const cur = store.find(id)?.goal.slot;
        if (slot !== cur) { tokens.settle(id); store.moveRoot(id, slot); } else tokens.settle(id);
      } else tokens.settle(id);
      dirty = true;
    },
  });

  // ---- cadran ----
  const layer = $('dial-layer'), sheet = $('sheet');
  const dial: Dial = new Dial({
    store, layer, sheet,
    topInset: () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0,
    tokenRect: id => tokens.tokenEl(id)?.getBoundingClientRect() ?? null,
    onOpen: id => { tokens.setHidden(id, true); },
    onClosed: id => { tokens.setHidden(id, false); dirty = true; },
    addChild: pid => createChild(pid),
    edit: id => editGoal(id),
    list: id => listModal(id),
    toggleDone: (id, el, quick) => toggleDone(id, el, quick),
    askDelete: async id => {
      const f = store.find(id);
      const n = f ? countTasks(f.goal) : 0;
      return confirmBox('Supprimer', `« ${f?.goal.title ?? ''} »${n ? ` et ses ${n} sous-éléments` : ''} seront définitivement supprimés.`, 'Supprimer');
    },
  });
  dial.bindSheet(); dial.bindTips();

  // ---- messages ----
  const toast = (html: string) => {
    const t = document.createElement('div');
    t.className = 'toast'; t.innerHTML = html;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3500);
  };

  // ---- reliquaire ----
  const relic = $('relic');
  const relicStack = relic.querySelector('.stack') as HTMLElement;
  const relicLiquid = relic.querySelector('.liquid') as HTMLElement;
  const updateRelic = () => {
    const arch = store.archived();
    const mapN = store.mapGoals().length;
    relic.querySelector('.count')!.textContent = String(arch.length);
    const level = arch.length + mapN ? arch.length / (arch.length + mapN) : 0;
    relicLiquid.style.height = Math.round(Math.min(0.92, level * 0.95 + (arch.length ? 0.06 : 0)) * 100) + '%';
    const show = arch.slice(0, 14).reverse(); // plus ancien en bas
    const H = relicStack.clientHeight || 280;
    const tokH = (relicStack.clientWidth || 44) * 1.12;
    const step = show.length > 1 ? Math.min(tokH * 0.62, (H - tokH) / (show.length - 1)) : 0;
    const keys = show.map(g => g.id).join(',');
    if (relicStack.dataset.keys !== keys) {
      relicStack.innerHTML = show.map(g => `<img src="${tokenSrc(g)}" alt="" data-id="${g.id}">`).join('');
      relicStack.dataset.keys = keys;
    }
    [...relicStack.children].forEach((im, i) => {
      const el = im as HTMLElement;
      const rot = ((i * 47) % 30) - 15;
      el.style.bottom = Math.round(i * step) + 'px';
      el.style.height = tokH + 'px';
      el.style.transform = `rotate(${rot}deg) translateX(${((i * 31) % 9) - 4}px)`;
    });
  };

  const flyToRelic = (from: DOMRect, g: Goal) => new Promise<void>(res => {
    const target = (relic.querySelector('.glass') as HTMLElement).getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'flyer';
    f.style.width = from.width + 'px'; f.style.height = from.height + 'px';
    f.innerHTML = `<img src="${tokenSrc(g)}" alt="">`;
    document.body.appendChild(f);
    const x0 = from.left, y0 = from.top;
    const x1 = target.left + target.width / 2 - from.width / 2, y1 = target.top + target.height * 0.7 - from.height / 2;
    const s1 = (target.width * 1.05) / from.width;
    const mx = (x0 + x1) / 2 + 40, my = Math.min(y0, y1) - 90;
    const anim = f.animate([
      { transform: `translate(${x0}px,${y0}px) scale(1) rotate(0deg)`, opacity: 1, offset: 0 },
      { transform: `translate(${mx}px,${my}px) scale(1.15) rotate(-14deg)`, opacity: 1, offset: 0.45, easing: 'ease-in' },
      { transform: `translate(${x1}px,${y1}px) scale(${s1}) rotate(0deg)`, opacity: 1, offset: 1 },
    ], { duration: 1250, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    anim.onfinish = () => { f.remove(); res(); };
  });

  // ---- validation ----
  const sparkle = (el: HTMLElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('div');
      const a = (i / 14) * Math.PI * 2, d = r.width * (0.7 + Math.random() * 0.6);
      p.style.cssText = `position:fixed;z-index:90;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;width:6px;height:6px;border-radius:50%;background:#ffe39a;box-shadow:0 0 10px 3px rgba(255,200,90,.9);pointer-events:none`;
      document.body.appendChild(p);
      p.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(.2)`, opacity: 0 }], { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => p.remove();
    }
  };

  async function toggleDone(id: string, el: HTMLElement | null, _quick: boolean): Promise<boolean> {
    const f = store.find(id);
    if (!f) return false;
    const g = f.goal;
    if (!g.done) {
      const isRoot = !f.parent;
      const rect = el?.getBoundingClientRect() ?? null;
      if (!store.setDone(id, true)) { toast('Accomplissez d’abord tous les sous-objectifs.'); return false; }
      sparkle(el);
      if (isRoot) {
        if (rect) { dial.close(true); await flyToRelic(rect, g); } else dial.close(true);
        updateRelic();
        relic.classList.remove('flash'); void relic.offsetWidth; relic.classList.add('flash');
        toast(`<b>Objectif accompli</b> · « ${esc(g.title)} » rejoint le reliquaire`);
      } else {
        const par = f.parent!;
        if (gstate(par, f.inactive) === 'ready') toast(`« ${esc(par.title)} » est <b>prêt à valider</b>`);
        else toast('Tâche accomplie ✦');
      }
    } else {
      const wasRoot = !f.parent;
      store.setDone(id, false);
      if (wasRoot) {
        dial.close(true);
        toast(`« ${esc(g.title)} » est replacé sur la carte`);
        if (g.slot != null) focusGoal(g.id);
      } else toast('Rouvert');
    }
    return true;
  }

  // ---- création / édition ----
  const randomOf = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  function createRoot(slot?: number) {
    goalModal({
      heading: 'Nouvel objectif', submit: 'Placer sur la carte', advancedOpen: false,
      initial: { title: '', note: '', emblem: randomOf(EMBLEMS).id as Emblem, material: randomOf(MATERIALS).id as Material },
      onSubmit: f => { void placeNewRoot(f, slot); },
    });
  }
  async function placeNewRoot(f: { title: string; note: string; emblem: Emblem; material: Material }, slot?: number) {
    busy = true;
    tokens.holdNext = true;
    const res = store.addRoot({ title: f.title, note: f.note || undefined, emblem: f.emblem, material: f.material, slot });
    const g = res.goal;
    const lobeAnim = res.lobe ? syncLobes(true) : null;
    await wait(300);
    if (lobeAnim) {
      await new Promise<void>(r => input.flyTo({ x: lobeAnim.x, y: lobeAnim.y, zoom: Math.min(cam.zoom, 0.32) }, 1300, r));
      await animateLobe(lobeAnim, 2800);
      toast('<b>Le territoire s’étend</b> · une nouvelle contrée se révèle');
      await wait(300);
    }
    if (g.slot != null) {
      const s = world.slots[g.slot];
      await new Promise<void>(r => input.flyTo({ x: s.x, y: s.y, zoom: Math.max(0.5, Math.min(cam.zoom, 0.8)) }, 1000, r));
    }
    tokens.release(g.id);
    busy = false;
  }
  function createChild(parentId: string) {
    const f = store.find(parentId);
    if (!f) return;
    const par = f.goal;
    goalModal({
      heading: 'Nouveau sous-objectif', submit: 'Ajouter', continueLabel: 'Ajouter et continuer', advancedOpen: false,
      initial: { title: '', note: '', emblem: par.emblem, material: par.material },
      onSubmit: (d, again) => {
        store.addChild(parentId, { title: d.title, note: d.note || undefined, emblem: d.emblem, material: d.material });
        toast(`Ajouté : « ${esc(d.title)} »`);
        void again;
      },
    });
  }
  function editGoal(id: string) {
    const f = store.find(id);
    if (!f) return;
    goalModal({
      heading: 'Modifier', submit: 'Enregistrer', advancedOpen: true,
      initial: { title: f.goal.title, note: f.goal.note ?? '', emblem: f.goal.emblem, material: f.goal.material },
      onSubmit: d => store.update(id, { title: d.title, note: d.note || undefined, emblem: d.emblem, material: d.material }),
    });
  }
  function listModal(id: string) {
    const f = store.find(id);
    if (!f) return;
    const exp = new Set<string>();
    const m = openModal(f.goal.title);
    const rerender = () => {
      const cur = store.find(id);
      if (!cur) { m.close(); return; }
      m.body.innerHTML = `<div class="rows">${treeRows(store, cur.goal, 0, exp, cur.inactive || !!cur.goal.inactive) || '<div class="empty">Aucun sous-objectif.</div>'}</div>
        <div class="card-foot" style="margin-top:12px"><button class="btn primary" id="l-add">${icon.plus}<span>Ajouter un sous-objectif</span></button></div>`;
      (m.body.querySelector('#l-add') as HTMLElement).onclick = () => createChild(id);
    };
    rerender();
    store.on(rerender);
    bindTree(m, store, rerender, { edit: eid => editGoal(eid) }, exp);
  }

  // ---- archives ----
  function openArchive() {
    const exp = new Set<string>();
    const m = openModal('Reliquaire · Archives');
    const render = () => {
      const arch = store.archived();
      if (!arch.length) { m.body.innerHTML = '<div class="empty">Le reliquaire est vide.<br>Les objectifs accomplis y viendront reposer.</div>'; return; }
      m.body.innerHTML = `<div class="rows">${arch.map(g => {
        const open = exp.has(g.id);
        const date = g.doneAt ? new Date(g.doneAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
        return `<div class="row is-done" data-id="${g.id}">
          ${g.children.length ? `<button class="exp" data-act="exp">${open ? '▾' : '▸'}</button>` : '<span style="width:24px"></span>'}
          <div class="tk"><img src="${tokenSrc(g)}" alt=""></div>
          <div class="tx"><b>${esc(g.title)}</b><small>${countTasks(g.children.length ? g : g)} tâche${countTasks(g) > 1 ? 's' : ''} · ${date}</small></div>
          <div class="tools"><button class="mini on" data-act="react" title="Réactiver sur la carte">${icon.undo}</button><button class="mini" data-act="edit" title="Modifier">${icon.edit}</button><button class="mini danger" data-act="del" title="Supprimer">${icon.trash}</button></div></div>
          ${open ? `<div class="tree">${treeRows(store, g, 1, exp)}</div>` : ''}`;
      }).join('')}</div>`;
    };
    render();
    const off = store.on(render);
    m.el.addEventListener('transitionend', () => { if (!m.el.isConnected) off(); });
    m.body.addEventListener('click', async ev => {
      const btn = (ev.target as HTMLElement).closest('[data-act="react"]') as HTMLElement | null;
      if (!btn) return;
      const id = (btn.closest('.row') as HTMLElement).dataset.id!;
      const g = store.find(id)?.goal;
      if (!g) return;
      m.close();
      busy = true;
      tokens.holdNext = true;
      const res = store.reactivate(id);
      const la = res.lobe ? syncLobes(true) : null;
      await wait(450);
      if (la) {
        await new Promise<void>(r => input.flyTo({ x: la.x, y: la.y, zoom: Math.min(cam.zoom, 0.32) }, 1200, r));
        await animateLobe(la, 2600);
      }
      if (g.slot != null) {
        const s = world.slots[g.slot];
        await new Promise<void>(r => input.flyTo({ x: s.x, y: s.y, zoom: Math.max(0.5, Math.min(cam.zoom, 0.8)) }, 1100, r));
      }
      tokens.release(id);
      busy = false;
      toast(`<b>Réactivé</b> · « ${esc(g.title)} » est replacé sur la carte`);
    });
    bindTree(m, store, render, { edit: eid => editGoal(eid) }, exp);
  }
  relic.addEventListener('click', openArchive);

  function focusGoal(id: string) {
    const g = store.find(id)?.goal;
    if (!g || g.slot == null) return;
    const s = world.slots[g.slot];
    busy = true;
    input.flyTo({ x: s.x, y: s.y, zoom: Math.max(0.5, cam.zoom) }, 900, () => { busy = false; tokens.release(id); });
  }

  // ---- menu ----
  let menuEl: HTMLElement | null = null;
  const closeMenu = () => { menuEl?.remove(); menuEl = null; };
  $('btn-menu').innerHTML = icon.menu;
  $('btn-home').innerHTML = icon.compass;
  $('btn-home').addEventListener('click', () => { if (!busy) input.flyTo({ x: world.hub.x, y: world.hub.y, zoom: startZoom() }, 1000); });
  $('btn-menu').addEventListener('click', e => {
    e.stopPropagation();
    if (menuEl) { closeMenu(); return; }
    menuEl = document.createElement('div');
    menuEl.className = 'menu';
    menuEl.innerHTML = `
      <button data-m="new">${icon.plus}Nouvel objectif</button>
      <button data-m="arch">${icon.scroll}Archives</button>
      <button data-m="help">${icon.compass}Guide</button>
      <button data-m="reset">${icon.undo}Réinitialiser les exemples</button>`;
    $('app').appendChild(menuEl);
    menuEl.addEventListener('click', async ev => {
      const a = (ev.target as HTMLElement).closest('[data-m]')?.getAttribute('data-m');
      closeMenu();
      if (a === 'new') createRoot();
      if (a === 'arch') openArchive();
      if (a === 'help') helpModal();
      if (a === 'reset' && await confirmBox('Réinitialiser', 'Effacer votre progression et recharger les objectifs d’exemple ?', 'Réinitialiser')) {
        dial.close(true);
        store.lobes = []; store.reset();
        lobeAnims.length = 0; syncLobes(false);
        cam.x = world.hub.x; cam.y = world.hub.y; cam.zoom = startZoom();
        tokens.sync(renderer); updateRelic(); dirty = true;
        toast('Le monde a été réinitialisé');
      }
    });
  });
  document.addEventListener('pointerdown', e => { if (menuEl && !(e.target as HTMLElement).closest('.menu,#btn-menu')) closeMenu(); });
  $('fab').addEventListener('click', () => createRoot());

  // ---- lumières dynamiques ----
  let lightsBase: (Light & { kind: string })[] = [];
  const buildLights = () => {
    const L: (Light & { kind: string })[] = [];
    for (const g of store.mapGoals()) {
      if (g.slot == null) continue;
      const s = world.slots[g.slot];
      const st = gstate(g);
      if (st === 'active') L.push({ x: s.x, y: s.y, r: 1.0, g: 0.62, b: 0.28, radius: 380, intensity: 0.95, kind: 'a' });
      else if (st === 'ready') L.push({ x: s.x, y: s.y, r: 1.0, g: 0.82, b: 0.36, radius: 560, intensity: 1.5, kind: 'r' });
      else if (st === 'inactive') L.push({ x: s.x, y: s.y, r: 0.35, g: 0.5, b: 0.9, radius: 230, intensity: 0.45, kind: 'i' });
    }
    for (const d of world.decor) {
      if (d.light) L.push({ x: d.x, y: d.y, ...d.light, intensity: 1.0, kind: 'c' });
      else if (d.smoke) L.push({ x: d.x, y: d.y, r: 1, g: 0.6, b: 0.3, radius: 260, intensity: 0.5, kind: 'v' });
    }
    lightsBase = L;
  };

  // ---- synchronisation modèle → vue ----
  const onStore = () => {
    tokens.sync(renderer);
    buildLights();
    dial.refresh();
    updateRelic();
    dirty = true;
  };
  store.on(onStore);
  onStore();

  // ---- boucle de rendu ----
  window.addEventListener('resize', doResize);
  window.addEventListener('orientationchange', () => setTimeout(doResize, 250));
  doResize();
  let last = 0, slow = 0, frames = 0;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const t = now / 1000;
    const moving = input.active || dirty;
    if (!moving && now - last < 33) return;
    const dtm = now - last;
    last = now;
    // résolution adaptative
    if (moving && dtm > 0) { slow += dtm > 34 ? 1 : -1; slow = clamp(slow, 0, 40); frames++; }
    if (slow >= 30 && dprCap > 1) { dprCap = Math.max(1, dprCap - 0.35); slow = 0; doResize(); }
    renderer.sun.az = 2.25 + Math.sin(t * 0.02) * 0.28;
    renderer.sun.el = 0.58 + Math.sin(t * 0.013 + 1) * 0.07;
    renderer.setLights(lightsBase.map(l => l.kind === 'r' ? { ...l, intensity: l.intensity * (0.85 + 0.15 * Math.sin(t * 3.3)) } : l.kind === 'a' ? { ...l, intensity: l.intensity * (0.92 + 0.08 * Math.sin(t * 1.6 + l.x)) } : l));
    renderer.detail = 1;
    renderer.render(cam, t);
    tokens.layout(cam, renderer);
    store.setCam({ x: cam.x, y: cam.y, zoom: cam.zoom });
    dirty = false;
  };
  requestAnimationFrame(loop);

  // exposition pour tests
  (window as any).__atlas = { store, cam, renderer, dial, tokens, input, world, toast, createRoot, openArchive, placeNewRoot, WORLD_SIZE, lobeAnims, setBusy: (b: boolean) => (busy = b) };

  setP(1, 'Prêt');
  await wait(250);
  $('loader').classList.add('hide');
  try {
    if (!localStorage.getItem('atlas-des-ambitions:hint')) {
      localStorage.setItem('atlas-des-ambitions:hint', '1');
      setTimeout(() => toast('Touchez un jeton pour l\u2019ouvrir · appui long pour le déplacer'), 1200);
    }
  } catch { /* stockage indisponible */ }
  document.addEventListener('contextmenu', e => e.preventDefault());
  void (null as unknown as Lobe);
}

boot().catch(err => {
  console.error(err);
  const m = document.getElementById('loader-msg');
  if (m) m.textContent = 'Erreur : ' + (err?.message ?? err);
});

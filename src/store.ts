// Modèle de données, règles de gestion des objectifs et persistance locale.
import { nextLobe, slotUnlocked } from './world/worldgen';
import type { World, Lobe } from './world/worldgen';
import { sampleGoals } from './sample';

export type Material = 'stone' | 'wood' | 'metal';
export type Emblem = 'sword' | 'book' | 'coin' | 'heart' | 'compass' | 'crown' | 'flame' | 'tree' | 'house' | 'gear';
export const EMBLEMS: { id: Emblem; label: string }[] = [
  { id: 'sword', label: 'Combat · sport' }, { id: 'book', label: 'Savoir · études' }, { id: 'coin', label: 'Richesse' },
  { id: 'heart', label: 'Santé · proches' }, { id: 'compass', label: 'Voyage' }, { id: 'crown', label: 'Carrière' },
  { id: 'flame', label: 'Création · art' }, { id: 'tree', label: 'Nature · long terme' }, { id: 'house', label: 'Foyer' }, { id: 'gear', label: 'Atelier · projets' },
];
export const MATERIALS: { id: Material; label: string }[] = [{ id: 'stone', label: 'Pierre' }, { id: 'wood', label: 'Bois' }, { id: 'metal', label: 'Métal' }];

export interface Goal {
  id: string;
  title: string;
  note?: string;
  emblem: Emblem;
  material: Material;
  inactive?: boolean;
  done?: boolean;
  doneAt?: number;
  createdAt: number;
  children: Goal[];
  slot?: number | null; // objectifs principaux sur la carte
}
export type GState = 'inactive' | 'active' | 'ready' | 'done';

export interface SaveData {
  v: 1;
  goals: Goal[];
  lobes: Lobe[];
  cam: { x: number; y: number; zoom: number };
}

const KEY = 'atlas-des-ambitions:v1';

export const uid = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function gstate(g: Goal, inactiveAncestor = false): GState {
  if (g.done) return 'done';
  if (g.inactive || inactiveAncestor) return 'inactive';
  if (g.children.length > 0 && g.children.every(c => c.done)) return 'ready';
  return 'active';
}
export function progress(g: Goal): { done: number; total: number } {
  if (g.children.length === 0) return { done: g.done ? 1 : 0, total: 1 };
  let d = 0, t = 0;
  for (const c of g.children) { const p = progress(c); d += g.done ? p.total : p.done; t += p.total; }
  return { done: d, total: t };
}
export function countTasks(g: Goal): number {
  return g.children.reduce((n, c) => n + 1 + countTasks(c), 0);
}

export interface Found { goal: Goal; parent: Goal | null; path: Goal[]; inactive: boolean }

export class Store {
  goals: Goal[] = [];
  lobes: Lobe[] = [];
  cam = { x: 0, y: 0, zoom: 0.5 };
  private listeners = new Set<() => void>();
  private saveTimer = 0;

  constructor(readonly world: World) {
    if (!this.load()) this.reset();
  }

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(f => f()); this.scheduleSave(); }

  // ---- persistance ----
  private load(): boolean {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const d = JSON.parse(raw) as SaveData;
      if (d.v !== 1 || !Array.isArray(d.goals) || !Array.isArray(d.lobes) || d.lobes.length === 0) return false;
      this.goals = d.goals; this.lobes = d.lobes; this.cam = d.cam;
      return true;
    } catch { return false; }
  }
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 250);
  }
  saveNow() {
    try {
      const d: SaveData = { v: 1, goals: this.goals, lobes: this.lobes, cam: this.cam };
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch { /* stockage indisponible (navigation privée) */ }
  }
  reset() {
    const w = this.world;
    this.lobes = [{ x: w.hub.x, y: w.hub.y, r: 1000 }];
    this.goals = sampleGoals();
    // placement des objectifs d'exemple sur les emplacements du premier territoire
    const taken = new Set<number>();
    for (const g of this.goals.filter(g => !g.done)) {
      const s = this.pickSlot(taken);
      g.slot = s;
      if (s != null) taken.add(s);
    }
    const hub = w.hub;
    this.cam = { x: hub.x, y: hub.y, zoom: 0 }; // 0 = zoom initial calculé selon l’écran
    this.emit();
  }

  // ---- recherche ----
  find(id: string): Found | null {
    const walk = (list: Goal[], parent: Goal | null, path: Goal[], inactive: boolean): Found | null => {
      for (const g of list) {
        if (g.id === id) return { goal: g, parent, path, inactive };
        const r = walk(g.children, g, [...path, g], inactive || !!g.inactive);
        if (r) return r;
      }
      return null;
    };
    return walk(this.goals, null, [], false);
  }
  mapGoals() { return this.goals.filter(g => !g.done); }
  archived() { return this.goals.filter(g => g.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)); }

  // ---- emplacements ----
  usedSlots(except?: string): Set<number> {
    const s = new Set<number>();
    for (const g of this.goals) if (!g.done && g.slot != null && g.id !== except) s.add(g.slot);
    return s;
  }
  freeSlots(): number[] {
    const used = this.usedSlots();
    return this.world.slots.filter(s => !used.has(s.id) && slotUnlocked(s, this.lobes)).map(s => s.id);
  }
  private pickSlot(taken: Set<number>): number | null {
    const used = this.usedSlots();
    taken.forEach(t => used.add(t));
    const hub = this.world.hub;
    // préfère les emplacements proches du barycentre des jetons existants, avec un peu de hasard
    const pts = this.mapGoals().filter(g => g.slot != null).map(g => this.world.slots[g.slot!]);
    const cx = pts.length ? pts.reduce((a, p) => a + p.x, 0) / pts.length : hub.x;
    const cy = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : hub.y;
    let best: number | null = null, bs = Infinity;
    for (const s of this.world.slots) {
      if (used.has(s.id) || !slotUnlocked(s, this.lobes)) continue;
      const sc = Math.hypot(s.x - cx, s.y - cy) + Math.hypot(s.x - hub.x, s.y - hub.y) * 0.5 + Math.random() * 220;
      if (sc < bs) { bs = sc; best = s.id; }
    }
    return best;
  }

  // ---- actions ----
  /** Crée un objectif principal. Étend le territoire si aucun emplacement n'est libre. */
  addRoot(d: { title: string; note?: string; emblem: Emblem; material: Material; slot?: number }): { goal: Goal; lobe: Lobe | null } {
    let lobe: Lobe | null = null;
    let slot: number | null = d.slot ?? null;
    if (slot == null) slot = this.pickSlot(new Set());
    if (slot == null) {
      lobe = nextLobe(this.world, this.lobes);
      if (lobe.r > 0) { this.lobes.push(lobe); slot = this.pickSlot(new Set()); } else lobe = null;
    }
    const goal: Goal = { id: uid(), title: d.title, note: d.note, emblem: d.emblem, material: d.material, createdAt: Date.now(), children: [], slot };
    this.goals.push(goal);
    this.emit();
    return { goal, lobe };
  }
  addChild(parentId: string, d: { title: string; note?: string; emblem: Emblem; material: Material }): Goal | null {
    const f = this.find(parentId);
    if (!f) return null;
    const g: Goal = { id: uid(), title: d.title, note: d.note, emblem: d.emblem, material: d.material, createdAt: Date.now(), children: [] };
    f.goal.children.push(g);
    // un parent déjà accompli qui reçoit une nouvelle tâche se rouvre
    if (f.goal.done) { f.goal.done = false; f.goal.doneAt = undefined; this.onReopen(f.goal); }
    this.emit();
    return g;
  }
  update(id: string, patch: Partial<Pick<Goal, 'title' | 'note' | 'emblem' | 'material'>>) {
    const f = this.find(id); if (!f) return;
    Object.assign(f.goal, patch);
    this.emit();
  }
  setInactive(id: string, v: boolean) {
    const f = this.find(id); if (!f) return;
    f.goal.inactive = v || undefined;
    this.emit();
  }
  /** Valide (ou rouvre) un objectif. Les parents ne peuvent être validés que lorsque tous leurs enfants le sont. */
  setDone(id: string, v: boolean): boolean {
    const f = this.find(id); if (!f) return false;
    const g = f.goal;
    if (v) {
      if (g.children.length && !g.children.every(c => c.done)) return false;
      g.done = true; g.doneAt = Date.now();
      if (!f.parent) g.slot = null; // rejoint les archives (reliquaire)
    } else {
      g.done = false; g.doneAt = undefined;
      this.onReopen(g);
    }
    // un parent rouvert si un enfant est rouvert
    if (!v) for (const p of f.path) if (p.done) { p.done = false; p.doneAt = undefined; this.onReopen(p); }
    this.emit();
    return true;
  }
  private onReopen(g: Goal) {
    // objectif principal rouvert : retourne sur la carte
    if (this.goals.includes(g) && g.slot == null) {
      g.slot = this.pickSlot(new Set());
      if (g.slot == null) {
        const lobe = nextLobe(this.world, this.lobes);
        if (lobe.r > 0) { this.lobes.push(lobe); g.slot = this.pickSlot(new Set()); this.pendingLobe = lobe; }
      }
    }
  }
  pendingLobe: Lobe | null = null;
  /** Réactive un objectif archivé : il retourne sur la carte. */
  reactivate(id: string): { lobe: Lobe | null } {
    const g = this.goals.find(x => x.id === id);
    if (!g) return { lobe: null };
    g.done = false; g.doneAt = undefined;
    g.slot = null;
    this.pendingLobe = null;
    this.onReopen(g);
    const lobe = this.pendingLobe; this.pendingLobe = null;
    this.emit();
    return { lobe };
  }
  moveRoot(id: string, slot: number) {
    const g = this.goals.find(x => x.id === id);
    if (!g || g.done) return;
    // si l'emplacement est pris : échange
    const other = this.goals.find(x => !x.done && x.slot === slot && x.id !== id);
    if (other) other.slot = g.slot;
    g.slot = slot;
    this.emit();
  }
  remove(id: string) {
    const f = this.find(id); if (!f) return;
    const list = f.parent ? f.parent.children : this.goals;
    list.splice(list.indexOf(f.goal), 1);
    this.emit();
  }
  setCam(c: { x: number; y: number; zoom: number }) { this.cam = c; this.scheduleSave(); }
}

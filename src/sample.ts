// Objectifs d'exemple (V1) : hiérarchie profonde, anneaux multiples, état « prêt à valider », archives.
import type { Goal, Emblem, Material } from './store';

let n = 0;
const now = Date.now(), DAY = 86400000;
type Opt = { done?: boolean; inactive?: boolean; note?: string; emblem?: Emblem; doneAgo?: number };
function g(title: string, emblem: Emblem, material: Material, children: Goal[] = [], o: Opt = {}): Goal {
  return {
    id: 's' + ++n, title, emblem, material, note: o.note, children,
    done: o.done || undefined, inactive: o.inactive || undefined,
    doneAt: o.done ? now - (o.doneAgo ?? 3) * DAY : undefined, createdAt: now - 40 * DAY,
  };
}
const t = (title: string, e: Emblem, m: Material, o: Opt = {}, kids: Goal[] = []) => g(title, e, m, kids, o);

export function sampleGoals(): Goal[] {
  n = 0;
  const marathon = g('Courir un marathon', 'sword', 'stone', [
    g('Plan d’entraînement 16 semaines', 'sword', 'stone', [
      t('Semaines 1–4 · base', 'sword', 'stone', { done: true }),
      t('Semaines 5–8 · fractionné', 'sword', 'stone', { done: true }),
      t('Semaines 9–12 · sorties longues', 'sword', 'stone'),
      t('Semaines 13–16 · affûtage', 'sword', 'stone'),
    ]),
    t('Acheter des chaussures adaptées', 'sword', 'stone', { done: true }),
    g('Courir 10 km sous 55 min', 'sword', 'stone', [], { done: true }),
    g('Courir un semi-marathon', 'sword', 'stone', [
      t('Choisir la course', 'sword', 'stone', { done: true }),
      t('S’inscrire', 'sword', 'stone', { done: true }),
      t('Finir en moins de 2 h', 'sword', 'stone'),
    ]),
    t('Consulter un médecin du sport', 'heart', 'stone'),
    t('S’inscrire au marathon', 'sword', 'stone'),
  ], { note: 'Objectif : franchir la ligne d’arrivée en moins de 4 h 15.' });

  const roman = g('Écrire mon premier roman', 'book', 'wood', [
    t('Synopsis', 'book', 'wood', { done: true }),
    t('Fiches personnages', 'book', 'wood', { done: true }),
    t('Carte du monde', 'compass', 'wood', { done: true }),
    ...Array.from({ length: 11 }, (_, i) => t(`Chapitre ${i + 1}`, 'book', 'wood', { done: i < 4 })),
  ], { note: '90 000 mots, premier jet terminé avant la fin de l’année.' });

  const epargne = g('Constituer 10 000 € d’épargne', 'coin', 'metal', [
    t('Ouvrir un livret dédié', 'coin', 'metal', { done: true }),
    t('Virement automatique mensuel', 'coin', 'metal', { done: true }),
    t('Réduire les abonnements inutiles', 'coin', 'metal', { done: true }),
    t('Vendre le matériel inutilisé', 'coin', 'metal', { done: true }),
    t('Atteindre 10 000 €', 'coin', 'metal', { done: true }),
  ], { note: 'Tout est accompli : il ne reste qu’à sceller l’objectif.' });

  const japon = g('Voyager au Japon', 'compass', 'wood', [
    t('Choisir la période', 'compass', 'wood'),
    t('Réserver les vols', 'compass', 'wood'),
    g('Itinéraire', 'compass', 'wood', [t('Tokyo', 'compass', 'wood'), t('Kyoto', 'compass', 'wood'), t('Osaka', 'compass', 'wood'), t('Hokkaido', 'compass', 'wood')]),
    t('Apprendre 50 mots de japonais', 'book', 'wood'),
  ], { inactive: true, note: 'En sommeil jusqu’à l’été prochain.' });

  const maison = g('Rénover la maison', 'house', 'stone', [
    g('Cuisine', 'house', 'stone', [
      t('Faire établir trois devis', 'house', 'stone', { done: true }),
      t('Choisir les meubles', 'house', 'stone'),
      g('Plomberie', 'gear', 'stone', [t('Évacuations', 'gear', 'stone'), t('Arrivées d’eau', 'gear', 'stone')]),
      t('Électricité', 'gear', 'stone'),
    ]),
    g('Salon', 'house', 'stone', [t('Peinture', 'flame', 'stone', { done: true }), t('Parquet', 'house', 'stone'), t('Éclairage', 'flame', 'stone')]),
    g('Jardin', 'tree', 'stone', [t('Terrasse', 'tree', 'stone'), t('Plantations', 'tree', 'stone'), t('Arrosage automatique', 'gear', 'stone')]),
    t('Isolation des combles', 'house', 'stone', { done: true }),
  ], { note: 'Budget : 28 000 €. Fin des travaux visée en octobre.' });

  const guitare = g('Apprendre la guitare', 'flame', 'metal', [
    t('Acheter une guitare', 'flame', 'metal', { done: true }),
    t('Jouer les accords ouverts', 'flame', 'metal', { done: true }),
    t('Premier morceau complet', 'flame', 'metal'),
    t('Jouer devant des amis', 'heart', 'metal'),
  ]);

  const entreprise = g('Lancer mon entreprise', 'crown', 'metal', [
    t('Étude de marché', 'crown', 'metal', { done: true }),
    t('Business plan', 'coin', 'metal', { done: true }),
    t('Choisir le statut juridique', 'book', 'metal'),
    t('Trouver un nom', 'flame', 'metal', { done: true }),
    t('Créer le site web', 'gear', 'metal'),
    t('Premiers clients', 'crown', 'metal'),
    t('Ouvrir le compte pro', 'coin', 'metal'),
    t('Assurance professionnelle', 'heart', 'metal'),
    t('Campagne de lancement', 'flame', 'metal'),
  ]);

  const permis = g('Passer le permis moto', 'gear', 'metal', [
    t('Code de la route', 'book', 'metal', { done: true, doneAgo: 60 }),
    t('Plateau', 'gear', 'metal', { done: true, doneAgo: 45 }),
    t('Circulation', 'gear', 'metal', { done: true, doneAgo: 33 }),
  ], { done: true, doneAgo: 28 });
  const livres = g('Lire 20 livres cette année', 'book', 'wood', [
    t('Dix premiers livres', 'book', 'wood', { done: true, doneAgo: 70 }),
    t('Dix suivants', 'book', 'wood', { done: true, doneAgo: 14 }),
  ], { done: true, doneAgo: 10 });
  const verger = g('Planter un verger', 'tree', 'stone', [
    t('Choisir les essences', 'tree', 'stone', { done: true, doneAgo: 100 }),
    t('Préparer le sol', 'tree', 'stone', { done: true, doneAgo: 90 }),
    t('Planter douze arbres', 'tree', 'stone', { done: true, doneAgo: 80 }),
  ], { done: true, doneAgo: 75 });

  return [marathon, roman, epargne, japon, maison, guitare, entreprise, permis, livres, verger];
}

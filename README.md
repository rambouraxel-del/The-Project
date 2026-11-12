# Atlas des Ambitions — V1

Application web immersive de gestion d'objectifs : une carte médiéval-fantasy en vue aérienne, des jetons gravés posés dans le paysage, des sous-objectifs en cadran téléphonique à anneaux, un reliquaire pour les accomplissements.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173 (même Wi-Fi : l'URL "Network" s'affiche pour l'iPhone)
npm run build      # produit dist/ (statique, hébergeable partout en HTTPS)
```

Déploiement HTTPS automatique : le workflow `.github/workflows/pages.yml` publie `dist/` sur GitHub Pages à chaque push sur `main` (activer *Settings → Pages → Source : GitHub Actions*).

## Architecture

| Dossier | Rôle |
|---|---|
| `src/world/worldgen.ts` | Monde procédural **déterministe** : relief, rivières, routes (arbre couvrant), emplacements de jetons, décors, lobes d'exploration. Données pures, sans rendu → réutilisables par un futur moteur 3D. |
| `src/world/shaders.ts`, `renderer.ts` | Rendu WebGL1 : terrain texturé (herbe/forêt/roche/sable/eau issus d'images IA), ombres du relief, lumières dynamiques des jetons, brume d'exploration, décors animés (sprites, ombres, fumée, navires, caravanes, dragon). |
| `src/world/camera.ts` | Gestes : glisser, pincer, molette, inertie, appui long pour déplacer un jeton. |
| `src/store.ts`, `sample.ts` | Modèle (arbre illimité), règles de validation, placement automatique, extension du territoire, persistance `localStorage`. |
| `src/ui/` | Jetons, cadran, fiche, fenêtres, reliquaire. |
| `tools/` | `gen_assets.py` (génération des visuels via l'API d'images), `process_assets.py` (recadrage, textures sans raccord, WebP). |

## Règles de gestion

- États : **inactif** (en sommeil) · **actif** · **prêt à valider** (tous les enfants accomplis) · **accompli**.
- Les tâches (sans enfant) se valident individuellement ; un parent ne se valide que lorsqu'il est *prêt*.
- Un objectif principal accompli quitte la carte pour le reliquaire ; ses sous-objectifs restent dans son arborescence. Archives modifiables ; **Réactiver** le replace sur la carte (le territoire s'étend si besoin).
- Sauvegarde automatique (progression, positions, territoire) dans le navigateur.

## Captures

`docs/screenshots/` : `desktop_*` (1440×900) et `mobile_*` (iPhone 390×844 @2x) — carte, cadran à un cercle, sous-niveau, deux anneaux, archives.

## Limites connues de la V1

- **Visuels générés par IA** (textures de terrain, sprites, jetons). Les jetons sont fournis en 3 matières × 10 gravures ; il n'y a pas encore d'illustration unique générée par objectif.
- **Monde fixe** (graine 1337, ~70 emplacements, 6 400 × 6 400 unités). Quand il est entièrement exploré, il faut agrandir la génération (le code est déjà paramétrable par graine/taille).
- **Rendu 2D éclairé** (vue satellite, relief ombré, ombres des décors) : pas encore de vraie 3D. Les données (hauteur, normales, masques, décors) sont isolées du rendu pour permettre un moteur Three.js/WebGPU plus tard.
- **Pas de synchronisation multi-appareils** : la sauvegarde est locale au navigateur (`localStorage`). Export/import JSON à ajouter.
- Les performances ont été validées en rendu logiciel (SwiftShader) ; la résolution s'adapte automatiquement si l'appareil est lent. À confirmer sur un iPhone réel.
- Pas de réorganisation manuelle de l'ordre des sous-objectifs ni de dates d'échéance (hors périmètre V1).

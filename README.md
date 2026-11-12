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

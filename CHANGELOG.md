# Changelog

Versionnage semver x.y.z ; la version s'affiche dans le jeu (Réglages).

## 2.3.0 - Réglages de la partie
- Écran de réglages avant chaque partie (solo et à plusieurs sur un téléphone) : un ou plusieurs thèmes, niveaux (CP à Terminale, groupes primaire/collège/lycée), 5/10/15/20/30 questions ou un nombre libre, temps par question ; réglages mémorisés.
- Tirage équitable entre thèmes x niveaux, sans doublon ; banque chargée à la demande (un fichier par thème x niveau).
- Records par réglage ; thème et niveau affichés sur chaque question ; version affichée dans les Réglages.

## 2.2.0 - Banque de questions par thème et niveau
- Banque de ~3 600 questions : 12 thèmes x niveaux scolaires français (CP à Terminale), un fichier JSON par thème x niveau dans `data/bank/`, relues une à une (réponse unique, niveau du programme).
- `scripts/build-index.mjs` génère `data/index.json` ; tests vitest de la banque (4 choix, 1 bonne réponse, pas de doublon).

## 2.1.0
- Accessibilité WCAG 2.2 AA, réglages persistés, récap des erreurs, mobile, performances.

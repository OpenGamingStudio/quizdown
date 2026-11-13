# Contribuer à QuizDown

Ce fichier complète les règles communes du studio : https://github.com/OpenGamingStudio/.github/blob/main/CONTRIBUTING.md (et le code de conduite : https://github.com/OpenGamingStudio/.github/blob/main/CODE_OF_CONDUCT.md). Lisez-les d'abord ; ici, seul le spécifique à QuizDown.

## Spécifique à QuizDown

QuizDown est un jeu web statique (navigateur et mobile), sans serveur à installer.

- **Lancer** : servir le dossier du jeu avec un serveur statique (ex. `python3 -m http.server`) et ouvrir la page dans le navigateur. Le détail sera précisé ici dès que le code du jeu sera en place.
- **Tester** : jouer une partie complète sur ordinateur et sur mobile (écran étroit) ; vérifier la console du navigateur (aucune erreur).
- **Questions et thématiques** : une question = un énoncé, des réponses, une seule bonne réponse, vérifiable par une source fiable. Pas de contenu offensant ni protégé par un droit d'auteur.
- **Modes de jeu** : un mode ne doit pas casser les modes existants (solo, multijoueur).
- **Code** : simple et lisible, sans dépendance inutile ; pas de secret ni de clé dans le dépôt.
- **Licence** : en contribuant, vous acceptez que votre travail soit publié sous [MIT](LICENSE).

## Tri des contributions

Chaque issue et chaque PR passe par un tri avant d'être étudiée par l'équipe.

1. **Accusé de réception** sous environ 1 h, avec l'étiquette `triage:en-cours`.
2. **Tri** sur trois critères :
   - **cohérence** : la contribution respecte l'esprit du jeu et les règles de ce fichier ;
   - **pertinence** : elle apporte quelque chose d'utile et ne fait pas doublon ;
   - **fonctionnement** : le jeu se lance et reste jouable (navigateur et mobile).
3. **Décision** :
   - `triage:valide` : la contribution passe ensuite à la validation par les développeurs du studio ;
   - `triage:rejete` : un commentaire en donne le motif, puis l'issue ou la PR est fermée.

# Changelog

Versionnage semver x.y.z ; la version s'affiche dans le jeu (Réglages).

## 3.1.1 - Fiabilité du multijoueur
- Plus de joueurs fantômes : retirés au retour au salon, et au salon après 60 s de déconnexion ; ils ne prennent plus de place.
- Reprise de connexion : si la room n'existe plus, un message clair au lieu d'un écran bloqué. L'hôte d'origine retrouve son rôle après une coupure brève.
- Deux onglets sur la même session : message « session ouverte ailleurs » au lieu d'une boucle d'expulsions.
- Revanche : réservée à l'hôte (les autres voient « En attente de l'hôte »). Réponse tardive ignorée sans erreur.
- Serveur : contrôle de l'Origin, coupure après des dépassements répétés de débit, IP cliente de repli si X-Forwarded-For est vide, salons inactifs expirés après 15 min.

## 3.1.0 - Jouer en ligne plus visible
- Accueil : « Créer une partie » et « Rejoindre avec un code » en gros boutons, en haut.
- Salle d'attente : « Copier le lien » et « Partager… » (partage natif sur mobile).
- Revanche en un clic pour tous les joueurs (plus seulement l'hôte).
- Vérifié en ligne avec deux clients réels (code, lien, manche, revanche, reconnexion).

## 3.0.0 - Jouer en ligne
- Nouveau mode « Jouer en ligne » : chacun sur son téléphone, room privée (aucune liste publique). Créer une room -> code de 5 caractères + lien à partager (`?room=CODE`) ; rejoindre en tapant le code ou en ouvrant le lien.
- Pseudo + avatar (12 visages), salle d'attente avec les joueurs connectés, l'hôte règle thèmes, niveaux, nombre de questions et temps (visible par tous) puis lance. Questions synchronisées, classement en direct, podium final, récap des erreurs avec la bonne réponse, rejouer.
- Reconnexion automatique si le téléphone se met en veille. Pseudos échappés. Solo et « plusieurs sur un téléphone » inchangés.

## 2.4.0 - Serveur multijoueur (en ligne, privé)
- Serveur WebSocket autoritaire (rooms privées en mémoire, codes de 5 caractères, 8 joueurs max, limites et rate limit par IP, reconnexion), derrière nginx (`/ws`) dans la même image (port 80). Protocole : `docs/MULTIJOUEUR.md`. Tests vitest du serveur. Pas encore d'écran dans le jeu (version 3.0.0).

## 2.3.0 - Réglages de la partie
- Écran de réglages avant chaque partie (solo et à plusieurs sur un téléphone) : un ou plusieurs thèmes, niveaux (CP à Terminale, groupes primaire/collège/lycée), 5/10/15/20/30 questions ou un nombre libre, temps par question ; réglages mémorisés.
- Tirage équitable entre thèmes x niveaux, sans doublon ; banque chargée à la demande (un fichier par thème x niveau).
- Records par réglage ; thème et niveau affichés sur chaque question ; version affichée dans les Réglages.

## 2.2.0 - Banque de questions par thème et niveau
- Banque de ~3 600 questions : 12 thèmes x niveaux scolaires français (CP à Terminale), un fichier JSON par thème x niveau dans `data/bank/`, relues une à une (réponse unique, niveau du programme).
- `scripts/build-index.mjs` génère `data/index.json` ; tests vitest de la banque (4 choix, 1 bonne réponse, pas de doublon).

## 2.1.0
- Accessibilité WCAG 2.2 AA, réglages persistés, récap des erreurs, mobile, performances.

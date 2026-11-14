# Audit accessibilité (WCAG 2.2 AA), branche `feat/a11y`

Outils : axe-core 4.11 (tags wcag2a/2aa/21a/21aa/22aa + best-practice, 8 écrans), Lighthouse 12 (mobile, Chrome 157), Puppeteer.

## Avant / après

| | avant (main) | après |
|---|---|---|
| Lighthouse accessibilité / bonnes pratiques / SEO | 100 / 100 / 100 | 100 / 100 / 100 |
| Lighthouse performance | 100 | 99 |
| axe, accueil | `label-content-name-mismatch` (grave) | 0 |
| axe, 6 autres écrans (paquets, question, retour de réponse, multi, passage de main, résultats) | idem + `page-has-heading-one` | 0 |
| axe, dialogue Réglages | n/a | 0 |
| Titre de page | « QuizDown » partout | un titre par écran (« Question 3 sur 10 · QuizDown ») |

Les scores Lighthouse étaient déjà à 100 : le gain est dans ce que les outils automatiques ne voient pas (ci-dessous).

## Changements

- Clavier : lien d'évitement, ordre logique, focus visible (anneau encre 3 px, 4,6:1 sur le plateau), focus déplacé sur le titre de chaque écran (sauf au premier affichage), Échap = retour / ferme le dialogue (focus restitué), Entrée = bouton principal. Raccourcis A-D / 1-4 désactivables (WCAG 2.1.4).
- Lecteur d'écran : un `h1` par écran, `h2` ensuite, landmarks (banner, main, contentinfo), zone `aria-live="polite"` unique hors de `<main>` : bonne / mauvaise réponse + bonne réponse + score, résultat de partie, temps restant par paliers (10 s et 5 s, 20 / 10 / 5 s en mode allongé), jamais chaque seconde. Réponses = boutons dans un groupe nommé par la question. Plus de `aria-live` sur tout `<main>`.
- Information jamais par la couleur seule : ✓ / ✗ + « Juste » / « Faux », lettre + forme sur chaque réponse (déjà en place, conservé).
- Réglages persistés (`quizdown.settings.v1`) : sons on/off, volume, minuteur normal / allongé x2 / désactivé, raccourcis clavier. Minuteur allongé ou désactivé : pas d'enchaînement automatique, record non enregistré (équité).
- Texte à 200 % : plus de hauteur fixe (bandeau de partie), titre de paquet à la ligne au lieu d'être tronqué, en-tête qui passe à la ligne ; aucun défilement horizontal à 320 px, 640 px et police 200 % (390 px).
- `prefers-reduced-motion` : toutes animations et transitions coupées. CSP inchangée (aucun style en ligne ajouté).
- Contrastes : encre sur tomate 4,64 ; blanc sur sarcelle 6,1 / sapin 6,29 / brique 6,54 ; encre sur miel 12,2 / rose 8,75. Blanc sur tomate (4,04) seulement en grand texte gras (logo, titre du paquet : seuil 3:1).
- Cibles tactiles : aucune cible interactive < 44 px sur les écrans accueil, paquets, question (mesuré à 390 px).

## Test clavier (Chrome, parcours réel simulé)

Chargement → Tab : Aller au contenu → logo → Réglages → Son → Jouer solo → Jouer à plusieurs → lien open source → sortie de page (aucun piège). Entrée sur Jouer solo → focus sur « Choisissez un paquet » → Tab, Entrée sur un paquet → focus sur la question → Tab : 1re réponse → Échap : « Quitter la partie ? », focus sur Continuer → Échap : retour au focus précédent → touche B : réponse, annonce « Faux. La bonne réponse était : … Score : 0. », focus sur « Question suivante » → Entrée : question 2.

## Lecteur d'écran

Aucun NVDA / VoiceOver / Orca / ChromeVox disponible sur le serveur d'intégration : **pas de test avec un vrai lecteur d'écran**. Vérifié à la place : arbre d'accessibilité Chrome (rôles et noms ci-dessus : banner / main / contentinfo, titres, boutons nommés) et contenu de la zone live à chaque événement (réponse, paliers de temps, fin de partie). Un passage NVDA ou VoiceOver par une personne reste à faire avant de revendiquer la conformité.

# Banque de questions QuizDown

Un fichier par thème x niveau : `data/bank/<theme>/<niveau>.json`, un tableau JSON :

    [{"q": "Combien font 7 x 8 ?", "a": ["56", "54", "63", "48"], "c": 0}, ...]

- `q` : énoncé (<= 200 caractères), `a` : exactement 4 réponses distinctes (<= 60 caractères chacune), `c` : index de la bonne réponse (0 a 3 ; l'ordre est mélangé au jeu, on peut donc varier `c`).
- Niveaux : cp ce1 ce2 cm1 cm2 6e 5e 4e 3e 2nde 1ere term.
- Thèmes : maths francais histoire geographie sciences physique-chimie anglais culture-generale arts sport numerique emc.
- >= 30 questions par fichier, aucune question en double (même énoncé) dans un thème.
- Questions originales, conformes aux programmes de l'Éducation nationale du niveau, UNE seule bonne réponse sans ambiguïté, mauvaises réponses plausibles mais clairement fausses. Pas d'info datée qui change (records, populations, présidents en exercice).
- `data/index.json` est généré par `node scripts/build-index.mjs` (ne pas l'éditer à la main).

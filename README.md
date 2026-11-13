# QuizDown

Jeu de quiz, seul ou à plusieurs, sur des thématiques prédéfinies. Jouable dans le navigateur et sur mobile.

Quiz game, solo or with others, on predefined themes. Playable in the browser and on mobile.

- Jouer / Play : https://quizdown.opengamingstudio.com
- Licence : [MIT](LICENSE)
- Projet de [OpenGamingStudio](https://github.com/OpenGamingStudio), studio de jeux web open source.

## Contribuer / Contributing

Les issues et les pull requests sont les bienvenues. Les contributions sont vérifiées (cohérence, pertinence, fonctionnement) puis relues par l'équipe avant fusion sur `main`.
Issues and pull requests are welcome. Contributions are checked (consistency, relevance, working state) and reviewed by the team before being merged into `main`.

## Jouer / Play

Le jeu est statique (HTML/JS) ; le style est écrit avec [Tailwind CSS](https://tailwindcss.com) v4 (source : `src/input.css`) et compilé dans `style.css`, qui est versionné : le déploiement statique n'a donc rien à construire. Il faut servir le dossier par HTTP, car le jeu charge `data/questions.json` :

```sh
python3 -m http.server 8000   # puis ouvrir http://localhost:8000
```

### Build du CSS (Tailwind)

Node.js 20 ou plus récent requis. Après toute modification de `src/input.css` ou des classes utilisées dans `app.js` / `index.html` :

```sh
npm install
npm run build   # génère style.css (minifié) ; `npm run dev` pour recompiler en continu
```

Commiter `style.css` avec la modification. Charte : papier, encre et rouge tampon, aucun dégradé.

- **Solo** : 10 questions tirées au hasard dans le thème, 4 réponses, 15 s par question. 100 points par bonne réponse + jusqu'à 50 points de bonus de rapidité. Le meilleur score par thème est gardé dans le `localStorage` du navigateur.
- **Multijoueur local** : 2 à 4 joueurs sur le même appareil. Les joueurs répondent à tour de rôle aux mêmes questions ; classement final.
- Clavier : touches `A` `B` `C` `D` (ou `1` à `4`) pour répondre. Le son (optionnel) se coupe avec le bouton « Son ».

### Docker et en-têtes de sécurité

Le `Dockerfile` compile le CSS (Tailwind, étape Node) puis sert le jeu avec `nginx:1.27-alpine`. `nginx.conf` et `security-headers.conf` posent : `server_tokens off`, une CSP stricte (`default-src 'none'`, scripts, styles, `fetch` et images limités à `'self'`, ni `unsafe-inline` ni CDN, `object-src 'none'`, `frame-ancestors 'none'`), HSTS (`max-age=31536000`, sans preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy` et `Permissions-Policy`. Les en-têtes sont répétés dans chaque `location` qui utilise `add_header` ; CSS/JS/polices sont mis en cache 1 h. Le jeu n'a ni script ni style inline : toute nouvelle ressource externe ou inline serait bloquée par la CSP.

```sh
docker build -t quizdown .
docker run --rm -p 8080:80 quizdown   # puis curl -sI http://localhost:8080
```

## Ajouter des questions / Add questions

Tout est dans `data/questions.json` :

```json
{"themes": [{"id": "geographie", "name": "Géographie", "questions": [
  {"q": "Quelle est la capitale de l'Australie ?", "a": ["Canberra", "Sydney", "Melbourne", "Perth"], "c": 0}
]}]}
```

- `q` : la question ; `a` : exactement 4 réponses ; `c` : l'indice (0 à 3) de la bonne réponse. Les réponses sont mélangées au jeu, la bonne peut donc rester en première position dans le fichier.
- Un nouveau thème = un nouvel objet dans `themes` (`id` unique, au moins 10 questions).

English: the game is a static site; serve the folder with any web server. Add questions in `data/questions.json` (`q` question, `a` four answers, `c` index of the correct one).

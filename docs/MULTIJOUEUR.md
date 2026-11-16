# Protocole multijoueur QuizDown (WebSocket /ws, JSON texte)

Serveur autoritaire : il choisit et mélange les questions, chronomètre, note. Le client n'envoie que son choix. Rooms en mémoire, privées (pas de liste).

## Client -> serveur (champ `t`)
- `{t:'create', name, avatar}` crée une room, le créateur est l'hôte.
- `{t:'join', code, name, avatar}`.
- `{t:'resume', code, pid, token}` reconnexion (téléphone en veille).
- `{t:'profile', name, avatar}` (lobby seulement).
- `{t:'settings', settings:{themes:[id], levels:[id], n, time}}` hôte, lobby. n entier 5..30, time dans 10,15,20,30 (secondes).
- `{t:'start'}` hôte, lobby, >= 2 joueurs connectés. Le serveur tire n questions sans doublon dans les couples thème x niveau choisis (erreur `empty` si aucune).
- `{t:'answer', qi, i}` i = index dans les 4 réponses envoyées (déjà mélangées par le serveur). Une seule réponse par question, la première compte.
- `{t:'again'}` hôte, phase final : retour au lobby, scores remis à zéro.
- `{t:'leave'}`, `{t:'ping'}` (réponse `{t:'pong'}`).

## Serveur -> client
- `{t:'joined', code, pid, token}` après create/join/resume.
- `{t:'room', ...}` état complet, renvoyé à chaque changement :
  `phase` ('lobby'|'question'|'reveal'|'final'), `code`, `host` (pid), `you` (pid), `settings`,
  `players:[{id,name,avatar,score,good,connected,answered}]` (answered = a répondu à la question en cours, sans dire quoi),
  `qi`, `total`, `q:{text,answers:[4],theme,level}` (phases question/reveal, jamais la bonne réponse avant reveal),
  `ms` (temps restant en ms à l'envoi, le client recale avec sa propre horloge), `T` (durée totale en ms),
  `reveal:{correct, results:[{id,i,gain}]}` (phase reveal, i = -1 si pas de réponse),
  `missed:[{q,a,mine}]` (phase final, UNIQUEMENT les erreurs du destinataire ; mine = null si temps écoulé).
- `{t:'error', code, msg}` codes : `bad`, `not_found`, `full`, `started`, `rate`, `host_only`, `empty`, `few`, `limit`.
- `{t:'closed'}` room expirée/supprimée.

## Règles
- Code : 5 caractères de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` hors O/0/I/1 (entrée insensible à la casse), tirés avec `crypto`.
- Score : 100 + round(50 * restant/T) si juste, sinon 0 (calculé avec l'horloge du serveur). La question se termine quand tous les connectés ont répondu ou à T ; reveal 4 s puis question suivante ; final après la dernière.
- Max 8 joueurs/room ; max 200 rooms ; pseudos 1..12 caractères, nettoyés (contrôles, espaces), uniques dans la room (suffixe sinon) ; avatar `a0`..`a11`.
- Déconnexion : le joueur reste (connected=false) et peut `resume` ; si l'hôte part, l'hôte passe au suivant connecté. Room supprimée 5 min sans joueur connecté, 45 min sans activité.
- Limites : message <= 2 Ko (ws maxPayload), 20 messages/s par connexion, 10 connexions/IP, 5 créations de room/min/IP, 15 tentatives `join` ratées/min/IP, sinon `rate`. IP = dernière entrée de X-Forwarded-For (posée par Traefik), sinon l'adresse du socket.

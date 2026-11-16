#!/bin/sh
# Lance le serveur Node (utilisateur non root) en arrière-plan puis nginx au premier plan ;
# si l'un des deux meurt, tout s'arrête (le conteneur redémarre).
NODE_PID=""
NGINX_PID=""
# vivant = existe et n'est pas un zombie (un enfant mort non récolté répondrait encore à kill -0)
alive() {
  [ -d "/proc/$1" ] && ! grep -q '^State:[[:space:]]*Z' "/proc/$1/status" 2>/dev/null
}
stop() {
  [ -n "$NODE_PID" ] && kill -TERM "$NODE_PID" 2>/dev/null
  [ -n "$NGINX_PID" ] && kill -QUIT "$NGINX_PID" 2>/dev/null
}
trap 'stop; wait; exit 0' TERM INT

su-exec node node /app/server/index.js &
NODE_PID=$!
nginx -g 'daemon off;' &
NGINX_PID=$!

while alive "$NODE_PID" && alive "$NGINX_PID"; do
  sleep 1
done
echo "docker-entrypoint: un processus s'est arrêté, arrêt du conteneur" >&2
stop
wait
exit 1

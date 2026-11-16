FROM node:22-alpine AS css
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY index.html app.js ./
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/index.js server/rooms.js server/bank.js ./

# Image finale unique : nginx (statiques + proxy /ws) et le serveur Node, port 80
FROM node:22-alpine
RUN apk add --no-cache nginx su-exec \
    && mkdir -p /etc/nginx/snippets /usr/share/nginx/html /run/nginx \
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY index.html app.js favicon.svg favicon.ico apple-touch-icon.png icon-192.png icon-512.png favicon-16.png favicon-32.png site.webmanifest /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/
COPY fonts/ /usr/share/nginx/html/fonts/
COPY --from=css /build/style.css /usr/share/nginx/html/style.css
# serveur multijoueur : /app/server, banque lue dans /app/data/bank (BANK_DIR par défaut ../data/bank)
COPY --from=server /srv /app/server
COPY data/ /app/data/
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENV NODE_ENV=production PORT=8080
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
ENTRYPOINT ["/docker-entrypoint.sh"]

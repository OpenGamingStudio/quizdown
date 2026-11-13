FROM node:22-alpine AS css
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY index.html app.js ./
RUN npm run build

FROM nginx:1.27-alpine
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/
COPY --from=css /build/style.css /usr/share/nginx/html/style.css

# Build from the repository root:
#   docker build -f packages/web/Dockerfile --build-arg VITE_GAME_SERVER=http://localhost:8787 -t civ1-web .
FROM node:20-bookworm-slim AS build

ARG VITE_GAME_SERVER=http://localhost:8787
ENV VITE_GAME_SERVER=$VITE_GAME_SERVER

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/web/package.json packages/web/package.json
# npm ci compiles the workspace's optional better-sqlite3 addon even though
# the web build does not use it; keep the toolchain for the build stage only.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache gettext
COPY --from=build /app/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY packages/web/config.template.js /etc/civ1/config.template.js
COPY packages/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV GAME_SERVER_URL=http://localhost:8787
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Build from the repository root:
#   docker build -f packages/server/Dockerfile -t civ1-server .
FROM node:20-bookworm-slim

WORKDIR /app

# Workspace manifests first for dependency-layer caching.
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/web/package.json packages/web/package.json

# better-sqlite3 is optional and only imported in single-process mode. The
# container uses PG_URL, so no native toolchain is needed in the image.
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund

COPY packages/server ./packages/server
COPY packages/shared ./packages/shared

ENV NODE_ENV=production
ENV PORT=8787
ENV WS_PORT=8788
EXPOSE 8787 8788

CMD ["npm", "run", "start:server"]

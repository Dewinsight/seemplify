FROM node:24-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY packages/journey-event-protocol/package.json packages/journey-event-protocol/package.json
COPY packages/journey-browser-sdk/package.json packages/journey-browser-sdk/package.json
COPY packages/journey-node/package.json packages/journey-node/package.json
COPY packages/journey-react/package.json packages/journey-react/package.json
COPY packages/journey-react-native/package.json packages/journey-react-native/package.json
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    RUNTIME_DIR=/app/runtime

WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN chmod 0755 /app/scripts/dokploy-entrypoint.sh \
  && mkdir -p /app/runtime \
  && chown -R node:node /app/runtime

USER node
EXPOSE 3000
VOLUME ["/app/runtime"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/scripts/dokploy-entrypoint.sh"]

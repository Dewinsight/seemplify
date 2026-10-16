FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    KNOWLEDGE_RUNTIME_HOST=0.0.0.0 \
    SEEMPLIFY_KNOWLEDGE_RUNTIME_DIR=/runtime \
    SEEMPLIFY_KNOWLEDGE_DATA_ROOT=/data

WORKDIR /app
COPY local-knowledge/package.json local-knowledge/package-lock.json ./
RUN ONNXRUNTIME_NODE_INSTALL=skip npm ci --omit=dev && npm cache clean --force
COPY local-knowledge/*.cjs local-knowledge/*.mjs ./

RUN mkdir -p /runtime /data /app/runtime/knowledge \
  && chown -R node:node /runtime /data /app/runtime

USER node
EXPOSE 11540
VOLUME ["/runtime", "/data"]

HEALTHCHECK --interval=20s --timeout=10s --start-period=30s --retries=10 \
  CMD node client.cjs status >/dev/null 2>&1 || exit 1

CMD ["node", "server.cjs"]

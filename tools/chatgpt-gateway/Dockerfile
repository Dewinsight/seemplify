FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --prefix /opt/codex --omit=dev --no-audit --no-fund @openai/codex@0.147.0 \
  && mkdir -p /data/codex-subjects \
  && chown -R node:node /data

COPY --chown=node:node tools/chatgpt-gateway /app/tools/chatgpt-gateway

ENV NODE_ENV=production \
  CHATGPT_GATEWAY_HOST=0.0.0.0 \
  CHATGPT_GATEWAY_PORT=11435 \
  CHATGPT_GATEWAY_DATA_DIR=/data \
  CODEX_CLI_PATH=/opt/codex/node_modules/@openai/codex/bin/codex.js \
  CODEX_SUBJECTS_DIR=/data/codex-subjects \
  CODEX_PER_USER_SESSIONS=true \
  CODEX_MAX_CONCURRENT_TURNS_PER_SUBJECT=4 \
  CODEX_SUBJECT_SOURCE_APPS=recruiter \
  HOME=/home/node

USER node

EXPOSE 11435

CMD ["node", "tools/chatgpt-gateway/server.cjs"]

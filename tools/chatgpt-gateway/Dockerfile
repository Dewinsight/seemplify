FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --prefix /opt/codex --omit=dev --no-audit --no-fund @openai/codex@0.147.0 \
  && mkdir -p /data/codex-subjects \
  && chown -R node:node /data

COPY --chown=node:node tools/local-llm /app/tools/local-llm
COPY --chown=node:node recruiter/backend/config /app/recruiter/backend/config

ENV NODE_ENV=production \
  CHATGPT_GATEWAY_MODE=hosted \
  LOCAL_LLM_GATEWAY_HOST=0.0.0.0 \
  LOCAL_LLM_GATEWAY_PORT=11435 \
  LOCAL_LLM_SECRET_FILE=/data/service-secret \
  LOCAL_LLM_CONTROL_SECRET_FILE=/data/control-secret \
  LOCAL_LLM_STATE_FILE=/data/state.json \
  LOCAL_LLM_LOG_FILE=/data/gateway.log \
  LOCAL_LLM_NONCE_DIR=/data/nonces \
  LOCAL_LLM_USAGE_OUTBOX_DIR=/data/usage-outbox \
  LOCAL_LLM_EXECUTION_RECEIPT_DIR=/data/execution-receipts \
  CODEX_CLI_PATH=/opt/codex/node_modules/@openai/codex/bin/codex.js \
  CODEX_SUBJECTS_DIR=/data/codex-subjects \
  CODEX_PER_USER_SESSIONS=true \
  CODEX_SUBJECT_SOURCE_APPS=recruiter \
  HOME=/home/node

USER node

EXPOSE 11435

CMD ["node", "tools/local-llm/gateway.cjs"]

# Dockerfile for Approver Backend (API Only)
# No frontend serving - frontend is deployed separately
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Data directory for uploaded logos (mount a volume to persist across deploys)
VOLUME ["/app/uploads"]

# Copy backend source
COPY server.js ./
COPY controllers ./controllers
COPY middleware ./middleware
COPY models ./models
COPY routes ./routes
COPY services ./services
COPY utils ./utils
COPY scripts ./scripts

EXPOSE 80

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "server.js"]

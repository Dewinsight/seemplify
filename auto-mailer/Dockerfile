# Multi-stage Dockerfile for Auto-mailer Backend + Frontend
# Build context: auto-mailer/ (parent of backend/ and frontend/)
FROM node:20-alpine AS builder

WORKDIR /app

# Backend: install deps
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Backend: copy source
COPY backend/ .

# Frontend: install deps and build
COPY frontend/package*.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

COPY frontend/vite.config.ts frontend/tsconfig*.json frontend/index.html ./frontend/
COPY frontend/src ./frontend/src
COPY frontend/public ./frontend/public

# Build frontend with production API URL
ARG VITE_API_URL=https://auto-mailer.seemplifyai.com
ENV VITE_API_URL=${VITE_API_URL}
RUN cd frontend && npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Backend
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.js ./
COPY --from=builder /app/config ./config
COPY --from=builder /app/controllers ./controllers
COPY --from=builder /app/middleware ./middleware
COPY --from=builder /app/models ./models
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/services ./services
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/data ./data
COPY --from=builder /app/package*.json ./

# Built frontend (served by backend in production)
COPY --from=builder /app/frontend/dist ./frontend/dist

EXPOSE 5012

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5012/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "server.js"]

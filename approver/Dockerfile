# Multi-stage Dockerfile for Approver Backend + Frontend
# Build context MUST be approver/ (parent of backend/ and frontend/)
FROM node:18-alpine AS builder

WORKDIR /app

# Backend: install deps
COPY backend/package*.json ./
RUN npm ci --only=production

# Backend: copy source
COPY backend/ .

# Frontend: install deps and build
COPY frontend/package*.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

COPY frontend/vite.config.ts frontend/tsconfig*.json frontend/index.html ./frontend/
COPY frontend/src ./frontend/src
COPY frontend/public ./frontend/public

RUN cd frontend && npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Backend
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.js ./
COPY --from=builder /app/controllers ./controllers
COPY --from=builder /app/middleware ./middleware
COPY --from=builder /app/models ./models
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/services ./services
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package*.json ./

# Built frontend (served by server.js in production)
COPY --from=builder /app/frontend/dist ./frontend/dist

EXPOSE 80

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "server.js"]

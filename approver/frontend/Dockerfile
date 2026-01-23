# Dockerfile for Approver Frontend (React/Vite - Static Build)
# Builds React app and serves via nginx
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build arguments for API URL (build-time injection)
# Default to api.approver.aiinigeria.com/api for production
ARG VITE_API_BASE_URL=https://api.approver.aiinigeria.com/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Build the React app (VITE_API_BASE_URL is injected at build time)
RUN npm run build

# Production stage: nginx
FROM nginx:alpine

# Copy built static files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config for SPA routing (all routes serve index.html)
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

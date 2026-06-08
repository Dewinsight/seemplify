FROM node:20-alpine AS builder

WORKDIR /app

# Build-time arguments for Next.js public env vars
ARG NEXT_PUBLIC_API_BASE_URL=https://api.seemplifyai.com
ARG NEXT_PUBLIC_WS_BASE_URL=wss://api.seemplifyai.com
ARG NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
ARG NEXT_PUBLIC_THEME_LIGHT_ENABLED=true
ARG NEXT_PUBLIC_THEME_DARK_ENABLED=false
ARG NEXT_PUBLIC_THEME_SYSTEM_ENABLED=false
ARG NEXT_PUBLIC_DEFAULT_THEME=light

# Set them as environment variables for the build
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_WS_BASE_URL=$NEXT_PUBLIC_WS_BASE_URL
ENV NEXT_PUBLIC_IDP_URL=$NEXT_PUBLIC_IDP_URL
ENV NEXT_PUBLIC_THEME_LIGHT_ENABLED=$NEXT_PUBLIC_THEME_LIGHT_ENABLED
ENV NEXT_PUBLIC_THEME_DARK_ENABLED=$NEXT_PUBLIC_THEME_DARK_ENABLED
ENV NEXT_PUBLIC_THEME_SYSTEM_ENABLED=$NEXT_PUBLIC_THEME_SYSTEM_ENABLED
ENV NEXT_PUBLIC_DEFAULT_THEME=$NEXT_PUBLIC_DEFAULT_THEME

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code (excluding .env files via .dockerignore)
COPY . .

# Remove any .env files that might have been copied
RUN rm -f .env .env.local .env.production .env.development 2>/dev/null || true

# Build the application with production env vars
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 5000

CMD ["npm", "start"]

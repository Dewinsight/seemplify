FROM node:20-alpine AS builder

WORKDIR /app

# Build-time arguments for Next.js public env vars (ONLY NEXT_PUBLIC_ vars)
ARG NEXT_PUBLIC_API_URL=https://api-performance.seemplifyai.com/api
ARG NEXT_PUBLIC_WS_URL=wss://api-performance.seemplifyai.com/ws
ARG NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
ARG NEXTAUTH_URL=https://performance.seemplifyai.com
ARG NEXTAUTH_SECRET=performance-management-secret-2024
ARG OIDC_ISSUER=https://auth.seemplifyai.com
ARG OIDC_CLIENT_ID=performance-management

# Set build-time environment variables (ONLY NEXT_PUBLIC_ vars are embedded in build)
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_IDP_URL=$NEXT_PUBLIC_IDP_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV OIDC_ISSUER=$OIDC_ISSUER
ENV OIDC_CLIENT_ID=$OIDC_CLIENT_ID

# OIDC_CLIENT_SECRET should be set at runtime in Dokploy, NOT build time

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Remove any .env files that might have been copied
RUN rm -f .env .env.local .env.production .env.development 2>/dev/null || true

# Build the application with production env vars
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Runtime environment variables (set in Dokploy)
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_IDP_URL=$NEXT_PUBLIC_IDP_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV OIDC_ISSUER=$OIDC_ISSUER
ENV OIDC_CLIENT_ID=$OIDC_CLIENT_ID
# OIDC_CLIENT_SECRET should be provided at runtime via Dokploy environment variables

# Copy necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 5005

CMD ["npm", "start"]

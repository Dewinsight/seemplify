FROM node:20-alpine AS builder

WORKDIR /app

# Build-time arguments for Next.js public env vars (ONLY NEXT_PUBLIC_ vars)
ARG NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
ARG NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com

# Set build-time environment variables (ONLY NEXT_PUBLIC_ vars are embedded in build)
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_IDP_URL=$NEXT_PUBLIC_IDP_URL

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Remove any .env files that might have been copied
RUN rm -f .env .env.local .env.production .env.development 2>/dev/null || true

# Create public directory if it doesn't exist
RUN mkdir -p public

# Build the application with production env vars
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5011

# Copy necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 5011

CMD ["npm", "start"]

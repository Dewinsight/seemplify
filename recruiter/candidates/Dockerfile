FROM node:20-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_RECRUITER_API_BASE_URL=https://api.seemplifyai.com
ENV NEXT_PUBLIC_RECRUITER_API_BASE_URL=$NEXT_PUBLIC_RECRUITER_API_BASE_URL

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN rm -f .env .env.local .env.production .env.development 2>/dev/null || true
RUN pnpm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 5300

CMD ["pnpm", "start"]

FROM node:22.11.0-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN mkdir -p /var/lib/mail-api \
    && chown -R node:node /app /var/lib/mail-api

USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MAIL_API_PORT||8080)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]

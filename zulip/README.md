# Seemplify Chat (Zulip)

Team collaboration and messaging platform for Seemplify, powered by [Zulip](https://zulip.com/).

## Features

- **Thread-based Conversations**: Organized discussions with topic-based threading
- **OIDC Single Sign-On**: Seamless login via Seemplify Identity Provider
- **Video Conferencing**: Built-in Jitsi Meet integration
- **File Sharing**: Upload and share files securely
- **Mobile Apps**: Native iOS and Android apps available
- **Email Notifications**: Powered by Brevo SMTP

## Deployment

### Production (Dokploy)

The application is automatically deployed via GitHub Actions when changes are pushed to `main`.

- **URL**: https://chat.seemplifyai.com
- **Authentication**: Login with Seemplify (OIDC)

### Local Development

1. Copy environment file:
   ```bash
   cp .env.example .env
   ```

2. Start services:
   ```bash
   docker compose up -d
   ```

3. Access at http://localhost:80

## OIDC Configuration

Zulip is configured to use Seemplify Identity Provider for authentication:

- **Provider URL**: https://auth.seemplifyai.com
- **Client ID**: `zulip`
- **Redirect URI**: `https://chat.seemplifyai.com/complete/oidc/`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Traefik (SSL)                        │
│                  chat.seemplifyai.com                    │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                      Zulip Server                        │
│                   (zulip/docker-zulip)                   │
└───┬─────────┬─────────┬─────────┬───────────────────────┘
    │         │         │         │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│Postgres│ │ Redis │ │RabbitMQ│ │Memcache│
└────────┘ └───────┘ └────────┘ └────────┘
```

## Services

| Service | Image | Purpose |
|---------|-------|---------|
| zulip | zulip/docker-zulip:11.4-0 | Main Zulip application |
| database | zulip/zulip-postgresql:14 | PostgreSQL database |
| redis | redis:alpine | Caching and sessions |
| rabbitmq | rabbitmq:4.1 | Message queue |
| memcached | memcached:alpine | In-memory caching |

## Environment Variables

See `.env.example` for all available configuration options.

## Admin Access

After first deployment, create an admin user:

```bash
docker compose exec zulip su zulip -c '/home/zulip/deployments/current/manage.py createsuperuser'
```

Or use OIDC login - the first user from the organization becomes admin.

## Troubleshooting

### Check Logs
```bash
docker compose logs -f zulip
```

### Restart Services
```bash
docker compose restart zulip
```

### Reset Database (Warning: Deletes all data!)
```bash
docker compose down -v
docker compose up -d
```

## License

Zulip is open source under the Apache 2.0 license.

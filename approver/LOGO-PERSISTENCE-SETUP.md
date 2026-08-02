# Logo Persistence Across Deployments

Organization logos are stored in `uploads/logos/` on the backend container filesystem. **Without a persistent volume, logos are lost on every deploy** when the container is replaced.

## Fix: Add Volume in Dokploy

1. Open **Dokploy** → **approver-backend** application
2. Go to **Settings** / **Volumes** (or equivalent)
3. Add a volume mount:
   - **Host path:** `/home/seemplify/approver-uploads` (or any path on the server)
   - **Container path:** `/app/uploads`
4. Save and redeploy

The `uploads` directory will persist on the host, so logos survive container replacements.

## Alternative: Docker Compose

If deploying via docker-compose, add:

```yaml
services:
  approver-backend:
    volumes:
      - approver-uploads:/app/uploads

volumes:
  approver-uploads:
```

## Verify

After adding the volume and redeploying:

1. Upload a logo in Organization Settings
2. Trigger a new deployment (e.g. push to main)
3. Logo should still appear after the new container starts

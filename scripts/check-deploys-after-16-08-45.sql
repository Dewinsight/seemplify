-- Check all deployments after the latest fix
SELECT 
    a.name,
    d.status,
    d."createdAt",
    LEFT(d.title, 50) as title_preview
FROM deployment d
JOIN application a ON d."applicationId" = a."applicationId"
WHERE a.name LIKE '%dev%'
  AND d."createdAt" > '2026-01-14T16:08:45'
ORDER BY d."createdAt" DESC
LIMIT 15;

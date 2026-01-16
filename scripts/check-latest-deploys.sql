-- Check latest deployments
SELECT 
    a.name,
    d.title,
    d.status,
    d."createdAt"
FROM deployment d
JOIN application a ON d."applicationId" = a."applicationId"
WHERE a.name LIKE '%dev%'
  AND d."createdAt" > '2026-01-14T16:00:00'
ORDER BY d."createdAt" DESC;

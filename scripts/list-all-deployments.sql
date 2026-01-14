-- List all deployments for dev apps
SELECT 
    a.name,
    d.status,
    d."startedAt",
    d."finishedAt"
FROM deployment d
JOIN application a ON d."applicationId" = a."applicationId"
WHERE a.name LIKE '%dev%'
ORDER BY d."createdAt" DESC
LIMIT 20;

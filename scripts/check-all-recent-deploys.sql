-- Check all deployments in last hour
SELECT 
    a.name,
    d.status,
    d."createdAt",
    LEFT(d.title, 40) as title
FROM deployment d
JOIN application a ON d."applicationId" = a."applicationId"
WHERE a.name LIKE '%dev%'
  AND d."createdAt" > '2026-01-14T15:30:00'
ORDER BY d."createdAt" DESC;

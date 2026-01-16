-- Check most recent deployments for dev apps
SELECT 
    "applicationId",
    title,
    status,
    "startedAt",
    "finishedAt"
FROM deployment 
WHERE "applicationId" LIKE 'dev-%'
ORDER BY "createdAt" DESC
LIMIT 10;

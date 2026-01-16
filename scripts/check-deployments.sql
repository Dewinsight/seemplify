-- Check recent deployments for dev apps
SELECT * FROM deployment 
WHERE "applicationId" LIKE 'dev-%'
ORDER BY "createdAt" DESC
LIMIT 5;

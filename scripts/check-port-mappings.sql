-- Check port mappings for production app
SELECT * FROM port 
WHERE "applicationId" IN (
    SELECT "applicationId" FROM application WHERE name = 'performance-backend'
)
LIMIT 2;

-- Check port mappings for dev app
SELECT * FROM port 
WHERE "applicationId" IN (
    SELECT "applicationId" FROM application WHERE name = 'performance-backend-dev'
)
LIMIT 2;

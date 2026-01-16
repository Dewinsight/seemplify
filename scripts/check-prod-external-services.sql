-- Check production apps for external service URLs
SELECT name, env
FROM application 
WHERE name = 'identity-provider'
LIMIT 1;

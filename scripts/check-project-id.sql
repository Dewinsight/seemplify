-- Check if dev apps have projectId set
SELECT name, "projectId", "environmentId"
FROM application 
WHERE name LIKE '%dev%'
LIMIT 3;

-- Check production app for comparison
SELECT name, "projectId", "environmentId"
FROM application 
WHERE name = 'identity-provider'
LIMIT 1;

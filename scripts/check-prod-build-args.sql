-- Check production frontend buildArgs format
SELECT name, "buildArgs", env
FROM application 
WHERE name = 'leave-frontend'
LIMIT 1;

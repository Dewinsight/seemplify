-- Check production app Dockerfile configuration
SELECT 
    name,
    dockerfile,
    "dockerContextPath",
    "buildPath"
FROM application 
WHERE name IN ('performance-backend', 'identity-provider', 'recruiter-backend')
ORDER BY name;

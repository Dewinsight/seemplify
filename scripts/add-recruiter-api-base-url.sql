UPDATE application
SET env = env || E'\nNEXT_PUBLIC_API_BASE_URL=https://api-dev.seemplifyai.com'
WHERE name = 'recruiter-frontend-dev';

SELECT name, env
FROM application 
WHERE name = 'recruiter-frontend-dev';

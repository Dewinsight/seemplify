-- Update dev frontends to use Dockerfile.dev
UPDATE application
SET dockerfile = './leave-management/frontend/Dockerfile.dev'
WHERE name = 'leave-frontend-dev';

UPDATE application
SET dockerfile = './performance/frontend/Dockerfile.dev'
WHERE name = 'performance-frontend-dev';

UPDATE application
SET dockerfile = './payroll/frontend/Dockerfile.dev'
WHERE name = 'payroll-frontend-dev';

UPDATE application
SET dockerfile = './recruiter/frontend/Dockerfile.dev'
WHERE name = 'recruiter-frontend-dev';

-- Verify
SELECT name, dockerfile
FROM application 
WHERE name LIKE '%frontend-dev%'
ORDER BY name;

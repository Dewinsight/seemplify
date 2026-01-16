-- Fix dockerContextPath to point to individual app directories
-- This ensures npm start runs from the correct package.json

UPDATE application 
SET "dockerContextPath" = CASE name
    WHEN 'identity-provider-dev' THEN './Identityprovider'
    WHEN 'recruiter-backend-dev' THEN './recruiter/backend'
    WHEN 'recruiter-frontend-dev' THEN './recruiter/frontend'
    WHEN 'leave-backend-dev' THEN './leave-management/backend'
    WHEN 'leave-frontend-dev' THEN './leave-management/frontend'
    WHEN 'performance-backend-dev' THEN './performance/backend'
    WHEN 'performance-frontend-dev' THEN './performance/frontend'
    WHEN 'payroll-backend-dev' THEN './payroll/backend'
    WHEN 'payroll-frontend-dev' THEN './payroll/frontend'
END,
dockerfile = CASE name
    WHEN 'identity-provider-dev' THEN 'Dockerfile'
    WHEN 'recruiter-backend-dev' THEN 'Dockerfile'
    WHEN 'recruiter-frontend-dev' THEN 'Dockerfile'
    WHEN 'leave-backend-dev' THEN 'Dockerfile'
    WHEN 'leave-frontend-dev' THEN 'Dockerfile'
    WHEN 'performance-backend-dev' THEN 'Dockerfile'
    WHEN 'performance-frontend-dev' THEN 'Dockerfile'
    WHEN 'payroll-backend-dev' THEN 'Dockerfile'
    WHEN 'payroll-frontend-dev' THEN 'Dockerfile'
END,
"applicationStatus" = 'idle'
WHERE name LIKE '%dev%';

-- Verify
SELECT name, dockerfile, "dockerContextPath" 
FROM application 
WHERE name LIKE '%dev%'
ORDER BY name;

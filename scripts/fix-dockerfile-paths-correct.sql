-- Fix dockerfile paths to match production configuration
-- dockerfile should have full path from repo root

UPDATE application 
SET dockerfile = CASE name
    WHEN 'identity-provider-dev' THEN './Identityprovider/Dockerfile'
    WHEN 'recruiter-backend-dev' THEN './recruiter/backend/Dockerfile'
    WHEN 'recruiter-frontend-dev' THEN './recruiter/frontend/Dockerfile'
    WHEN 'leave-backend-dev' THEN './leave-management/backend/Dockerfile'
    WHEN 'leave-frontend-dev' THEN './leave-management/frontend/Dockerfile'
    WHEN 'performance-backend-dev' THEN './performance/backend/Dockerfile'
    WHEN 'performance-frontend-dev' THEN './performance/frontend/Dockerfile'
    WHEN 'payroll-backend-dev' THEN './payroll/backend/Dockerfile'
    WHEN 'payroll-frontend-dev' THEN './payroll/frontend/Dockerfile'
END,
"applicationStatus" = 'idle'
WHERE name LIKE '%dev%';

-- Verify the fix
SELECT name, dockerfile, "dockerContextPath"
FROM application 
WHERE name LIKE '%dev%'
ORDER BY name;

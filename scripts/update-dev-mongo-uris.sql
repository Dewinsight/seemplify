-- Update MongoDB URIs to match local development databases

-- Identity Provider - use 'identity' database
UPDATE application
SET env = REPLACE(env, 'identity-dev', 'identity')
WHERE name = 'identity-provider-dev';

-- Recruiter Backend - use 'smart_hr_db' database  
UPDATE application
SET env = REPLACE(env, 'smart_hr_db-dev', 'smart_hr_db')
WHERE name = 'recruiter-backend-dev';

-- Leave Backend - use 'leave-management_dev' database
UPDATE application
SET env = REPLACE(env, 'leave-management-dev', 'leave-management_dev')
WHERE name = 'leave-backend-dev';

-- Performance Backend - use 'performance_db_dev' database
UPDATE application
SET env = REPLACE(env, 'performance-dev', 'performance_db_dev')
WHERE name = 'performance-backend-dev';

-- Payroll Backend - use 'payroll_db_dev' database
UPDATE application
SET env = REPLACE(env, 'payroll-dev', 'payroll_db_dev')
WHERE name = 'payroll-backend-dev';

-- Verify updates
SELECT name, 
       CASE 
         WHEN env LIKE '%identity%' THEN SUBSTRING(env FROM 'mongodb[^?]+')
         WHEN env LIKE '%smart_hr%' THEN SUBSTRING(env FROM 'mongodb[^?]+')
         WHEN env LIKE '%leave%' THEN SUBSTRING(env FROM 'mongodb[^?]+')
         WHEN env LIKE '%performance%' THEN SUBSTRING(env FROM 'mongodb[^?]+')
         WHEN env LIKE '%payroll%' THEN SUBSTRING(env FROM 'mongodb[^?]+')
       END as mongo_uri_preview
FROM application
WHERE name LIKE '%backend%dev%' OR name = 'identity-provider-dev'
ORDER BY name;

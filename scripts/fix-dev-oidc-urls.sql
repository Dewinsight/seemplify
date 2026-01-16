-- Fix recruiter-backend-dev: Add OIDC config
UPDATE application
SET env = env || E'\nOIDC_REDIRECT_URI=https://api-dev.seemplifyai.com/api/auth/oidc/callback\nIDP_ISSUER_URL=https://auth-dev.seemplifyai.com\nOIDC_CLIENT_ID=smarthr-backend\nOIDC_CLIENT_SECRET=smarthr-secret'
WHERE name = 'recruiter-backend-dev'
  AND env NOT LIKE '%OIDC_REDIRECT_URI%';

-- Fix payroll-backend-dev: Correct the URL format (remove _db)
UPDATE application
SET env = REPLACE(env, 'api-payroll_db_dev.seemplifyai.com', 'api-payroll-dev.seemplifyai.com')
WHERE name = 'payroll-backend-dev';

UPDATE application
SET env = REPLACE(env, 'payroll_db_dev.seemplifyai.com', 'payroll-dev.seemplifyai.com')
WHERE name = 'payroll-backend-dev';

-- Fix performance-backend-dev: Correct the URL format (remove _db)
UPDATE application
SET env = REPLACE(env, 'api-performance_db_dev.seemplifyai.com', 'api-performance-dev.seemplifyai.com')
WHERE name = 'performance-backend-dev';

UPDATE application
SET env = REPLACE(env, 'performance_db_dev.seemplifyai.com', 'performance-dev.seemplifyai.com')
WHERE name = 'performance-backend-dev';

-- Verify the changes
SELECT name, 
       SUBSTRING(env FROM 'OIDC_REDIRECT_URI=([^\n]*)') as oidc_redirect,
       SUBSTRING(env FROM 'IDP_ISSUER_URL=([^\n]*)') as idp_issuer,
       SUBSTRING(env FROM 'FRONTEND_URL=([^\n]*)') as frontend_url
FROM application 
WHERE name IN ('recruiter-backend-dev', 'leave-backend-dev', 'performance-backend-dev', 'payroll-backend-dev')
ORDER BY name;

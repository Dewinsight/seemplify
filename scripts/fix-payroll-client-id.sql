-- Fix payroll backend client ID to match clients.json
UPDATE application
SET env = REPLACE(env, 'OIDC_CLIENT_ID=payroll', 'OIDC_CLIENT_ID=payroll-management')
WHERE name = 'payroll-backend-dev';

UPDATE application
SET env = REPLACE(env, 'OIDC_CLIENT_SECRET=payroll-secret', 'OIDC_CLIENT_SECRET=payroll-management-secret')
WHERE name = 'payroll-backend-dev';

-- Verify
SELECT name, 
       SUBSTRING(env FROM 'OIDC_CLIENT_ID=([^\n]*)') as client_id,
       SUBSTRING(env FROM 'OIDC_CLIENT_SECRET=([^\n]*)') as client_secret
FROM application 
WHERE name = 'payroll-backend-dev';

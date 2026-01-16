-- Add NEXT_PUBLIC_IDP_URL to all dev frontends
UPDATE application
SET env = env || E'\nNEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com'
WHERE name = 'leave-frontend-dev'
  AND env NOT LIKE '%NEXT_PUBLIC_IDP_URL%';

UPDATE application
SET env = env || E'\nNEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com'
WHERE name = 'performance-frontend-dev'
  AND env NOT LIKE '%NEXT_PUBLIC_IDP_URL%';

UPDATE application
SET env = env || E'\nNEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com'
WHERE name = 'payroll-frontend-dev'
  AND env NOT LIKE '%NEXT_PUBLIC_IDP_URL%';

UPDATE application
SET env = env || E'\nNEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com'
WHERE name = 'recruiter-frontend-dev'
  AND env NOT LIKE '%NEXT_PUBLIC_IDP_URL%';

-- Verify
SELECT name, 
       SUBSTRING(env FROM 'NEXT_PUBLIC_IDP_URL=([^\n]*)') as next_idp_url,
       SUBSTRING(env FROM 'NEXT_PUBLIC_API_URL=([^\n]*)') as next_api_url
FROM application 
WHERE name LIKE '%frontend-dev%'
ORDER BY name;

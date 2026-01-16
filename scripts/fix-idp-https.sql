-- Ensure all IDP_ISSUER_URL use https
UPDATE application
SET env = REPLACE(env, 'IDP_ISSUER_URL=http://auth-dev', 'IDP_ISSUER_URL=https://auth-dev')
WHERE name LIKE '%dev%';

UPDATE application
SET env = REPLACE(env, 'IDP_ISSUER_URL=http://auth.', 'IDP_ISSUER_URL=https://auth.')
WHERE name LIKE '%dev%';

-- Verify
SELECT name, SUBSTRING(env FROM 'IDP_ISSUER_URL=([^\n]*)') as idp_issuer
FROM application 
WHERE name LIKE '%dev%'
ORDER BY name;

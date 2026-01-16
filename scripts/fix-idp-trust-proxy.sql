-- Add TRUST_PROXY=true to Identity Provider Dev
UPDATE application
SET env = env || E'\nTRUST_PROXY=true'
WHERE name = 'identity-provider-dev'
  AND env NOT LIKE '%TRUST_PROXY%';

-- Verify
SELECT name, 
       SUBSTRING(env FROM 'TRUST_PROXY=([^\n]*)') as trust_proxy,
       SUBSTRING(env FROM 'ISSUER_URL=([^\n]*)') as issuer_url
FROM application 
WHERE name = 'identity-provider-dev';

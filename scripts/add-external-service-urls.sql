-- Add production URLs for Outline, OpenWebUI, and LMS to dev Identity Provider
UPDATE application
SET env = env || E'\nOPENWEBUI_URL=https://ai.seemplifyai.com\nOUTLINE_URL=https://docs.seemplifyai.com\nLMS_URL=https://lms.seemplifyai.com'
WHERE name = 'identity-provider-dev'
  AND env NOT LIKE '%OPENWEBUI_URL%';

-- Verify
SELECT name, 
       SUBSTRING(env FROM 'OPENWEBUI_URL=([^\n]*)') as openwebui,
       SUBSTRING(env FROM 'OUTLINE_URL=([^\n]*)') as outline,
       SUBSTRING(env FROM 'LMS_URL=([^\n]*)') as lms
FROM application 
WHERE name = 'identity-provider-dev';

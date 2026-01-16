-- Check all external service URLs in dev apps
SELECT name, 
       SUBSTRING(env FROM 'OUTLINE.*URL=([^\n]*)') as outline_url,
       SUBSTRING(env FROM 'OPENWEBUI.*URL=([^\n]*)') as openwebui_url,
       SUBSTRING(env FROM 'AI.*URL=([^\n]*)') as ai_url,
       SUBSTRING(env FROM 'LMS.*URL=([^\n]*)') as lms_url,
       SUBSTRING(env FROM 'DOCS.*URL=([^\n]*)') as docs_url
FROM application 
WHERE name LIKE '%dev%'
ORDER BY name;

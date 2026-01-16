SELECT name, 
       SUBSTRING(env FROM 'NEXT_PUBLIC_IDP_URL=([^\n]*)') as next_idp_url,
       SUBSTRING(env FROM 'NEXT_PUBLIC_API_URL=([^\n]*)') as next_api_url,
       SUBSTRING(env FROM 'VITE_IDP_URL=([^\n]*)') as vite_idp_url,
       SUBSTRING(env FROM 'VITE_API_URL=([^\n]*)') as vite_api_url
FROM application 
WHERE name LIKE '%frontend-dev%' OR name LIKE '%frontend' AND name NOT LIKE '%dev%'
ORDER BY name;

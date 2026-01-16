SELECT name, 
       SUBSTRING(env FROM 'OIDC_REDIRECT_URI=([^\n]*)') as oidc_redirect,
       SUBSTRING(env FROM 'IDP_ISSUER_URL=([^\n]*)') as idp_issuer,
       SUBSTRING(env FROM 'FRONTEND_URL=([^\n]*)') as frontend_url
FROM application 
WHERE name LIKE '%dev%' 
ORDER BY name;

UPDATE application
SET env = 'NODE_ENV=development
NEXT_PUBLIC_API_BASE_URL=https://api-dev.seemplifyai.com
NEXT_PUBLIC_WS_BASE_URL=wss://api-dev.seemplifyai.com
NEXT_PUBLIC_API_URL=https://api-dev.seemplifyai.com
NEXT_PUBLIC_AUTH_URL=https://auth-dev.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
NEXT_PUBLIC_THEME_LIGHT_ENABLED=true
NEXT_PUBLIC_THEME_DARK_ENABLED=false
NEXT_PUBLIC_THEME_SYSTEM_ENABLED=false
NEXT_PUBLIC_DEFAULT_THEME=light'
WHERE name = 'recruiter-frontend-dev';

SELECT name, env
FROM application 
WHERE name = 'recruiter-frontend-dev';

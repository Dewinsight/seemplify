-- Set build args for leave-frontend-dev
UPDATE application
SET "buildArgs" = 'NEXT_PUBLIC_API_URL=https://api-leave-dev.seemplifyai.com/api
NEXT_PUBLIC_WS_URL=wss://api-leave-dev.seemplifyai.com/ws
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
NEXT_PUBLIC_APP_URL=https://leave-dev.seemplifyai.com'
WHERE name = 'leave-frontend-dev';

-- Set build args for performance-frontend-dev
UPDATE application
SET "buildArgs" = 'NEXT_PUBLIC_API_URL=https://api-performance-dev.seemplifyai.com/api
NEXT_PUBLIC_WS_URL=wss://api-performance-dev.seemplifyai.com/ws
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
NEXT_PUBLIC_APP_URL=https://performance-dev.seemplifyai.com'
WHERE name = 'performance-frontend-dev';

-- Set build args for payroll-frontend-dev
UPDATE application
SET "buildArgs" = 'NEXT_PUBLIC_API_URL=https://api-payroll-dev.seemplifyai.com/api
NEXT_PUBLIC_WS_URL=wss://api-payroll-dev.seemplifyai.com/ws
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
NEXT_PUBLIC_APP_URL=https://payroll-dev.seemplifyai.com'
WHERE name = 'payroll-frontend-dev';

-- Set build args for recruiter-frontend-dev
UPDATE application
SET "buildArgs" = 'NEXT_PUBLIC_API_URL=https://api-dev.seemplifyai.com/api
NEXT_PUBLIC_WS_URL=wss://api-dev.seemplifyai.com/ws
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
NEXT_PUBLIC_APP_URL=https://app-dev.seemplifyai.com'
WHERE name = 'recruiter-frontend-dev';

-- Verify
SELECT name, "buildArgs"
FROM application 
WHERE name LIKE '%frontend-dev%'
ORDER BY name;

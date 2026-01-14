-- Compare production and dev app configuration
SELECT 'PRODUCTION' as type, *
FROM application 
WHERE name = 'identity-provider'

UNION ALL

SELECT 'DEV' as type, *
FROM application 
WHERE name = 'identity-provider-dev';

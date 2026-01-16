-- Compare service-related configuration between prod and dev
SELECT 
    'PROD' as type,
    name,
    port,
    "deploymentServerId",
    "networkSwarm",
    "labelsSwarm",
    "modeSwarm"
FROM application 
WHERE name = 'performance-backend'

UNION ALL

SELECT 
    'DEV' as type,
    name,
    port,
    "deploymentServerId",
    "networkSwarm",
    "labelsSwarm",
    "modeSwarm"
FROM application 
WHERE name = 'performance-backend-dev';

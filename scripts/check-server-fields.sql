-- Check server-related fields
SELECT 
    name,
    "serverId",
    "buildServerId",
    "registryId",
    "buildRegistryId"
FROM application 
WHERE name IN ('performance-backend', 'performance-backend-dev')
ORDER BY name;

-- Check if domains have port configuration
SELECT 
    d.host,
    d.port,
    d.https,
    a.name as app_name
FROM domain d
JOIN application a ON d."applicationId" = a."applicationId"
WHERE a.name LIKE '%dev%'
ORDER BY d.host;

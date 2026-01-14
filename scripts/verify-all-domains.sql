-- Verify domain configuration in Dokploy
SELECT 
    d.host,
    d.port,
    d.https,
    d."certificateType",
    a.name as app_name,
    a."applicationStatus"
FROM domain d
JOIN application a ON d."applicationId" = a."applicationId"
WHERE a.name LIKE '%dev%'
ORDER BY d.host;

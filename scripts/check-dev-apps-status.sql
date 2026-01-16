-- Check dev applications status
SELECT 
    name,
    "applicationStatus",
    "customGitUrl",
    "customGitBranch",
    "customGitBuildPath",
    "autoDeploy"
FROM application 
WHERE name LIKE '%dev%'
ORDER BY name;

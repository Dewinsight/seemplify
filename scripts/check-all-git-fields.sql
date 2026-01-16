-- Check all Git-related fields for production app
SELECT 
    name,
    "sourceType",
    "buildType",
    "githubId",
    "customGitUrl",
    "customGitBranch",
    "customGitBuildPath",
    dockerfile,
    "dockerContextPath",
    "applicationStatus"
FROM application 
WHERE name = 'identity-provider'
LIMIT 1;

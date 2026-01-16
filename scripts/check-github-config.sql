-- Check GitHub configuration for production app
SELECT name, "githubId", "customGitUrl", "customGitBranch", "customGitBuildPath"
FROM application 
WHERE name = 'identity-provider'
LIMIT 1;

-- Check GitHub configuration for dev app  
SELECT name, "githubId", "customGitUrl", "customGitBranch", "customGitBuildPath"
FROM application 
WHERE name = 'identity-provider-dev'
LIMIT 1;

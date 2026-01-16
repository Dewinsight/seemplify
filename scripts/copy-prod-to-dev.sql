-- Copy EXACT production configuration to dev apps
-- Just change: name, appName, branch to 'dev', and domains

-- Get all fields from identity-provider production
SELECT * FROM application WHERE name = 'identity-provider' LIMIT 1;

-- Show what we'll copy
SELECT 
    name,
    "sourceType",
    "buildType", 
    dockerfile,
    "dockerContextPath",
    "customGitBranch",
    env
FROM application 
WHERE name = 'identity-provider';

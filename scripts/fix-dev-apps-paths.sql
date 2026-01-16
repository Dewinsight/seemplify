-- Fix dev applications by clearing customGitBuildPath
-- This field should be empty when using dockerContextPath

UPDATE application 
SET "customGitBuildPath" = NULL,
    "applicationStatus" = 'idle'
WHERE name LIKE '%dev%';

-- Verify the fix
SELECT name, "customGitBuildPath", dockerfile, "dockerContextPath", "applicationStatus"
FROM application 
WHERE name LIKE '%dev%'
ORDER BY name;

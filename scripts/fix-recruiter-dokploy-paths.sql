-- Recruiter Dokploy path fix (production)
-- Use the same pattern as other working custom-git apps:
--   buildPath/dockerContextPath/dockerfile are full repo-relative paths
--   customGitBuildPath must be empty
UPDATE application SET
  "buildPath" = './recruiter/backend',
  "dockerContextPath" = './recruiter/backend',
  dockerfile = './recruiter/backend/Dockerfile',
  "customGitBuildPath" = ''
WHERE "applicationId" = 'tPMolDg5OEdQUBZ4MKMFh';

UPDATE application SET
  "buildPath" = './recruiter/frontend',
  "dockerContextPath" = './recruiter/frontend',
  dockerfile = './recruiter/frontend/Dockerfile',
  "customGitBuildPath" = ''
WHERE "applicationId" = 'k_p-9M7ZWEhSSf_0JusGs';

SELECT
  name,
  "buildPath",
  "dockerContextPath",
  dockerfile,
  "customGitBuildPath",
  "createEnvFile"
FROM application
WHERE name LIKE '%recruiter%';

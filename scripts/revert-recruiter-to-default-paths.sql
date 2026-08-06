-- Revert recruiter build paths to default (recruiter/ not recruiter/new/)
UPDATE application SET
  "buildPath" = './recruiter/backend',
  "dockerContextPath" = './recruiter/backend',
  dockerfile = './recruiter/backend/Dockerfile',
  "customGitBuildPath" = './recruiter/backend'
WHERE "applicationId" = 'tPMolDg5OEdQUBZ4MKMFh';

UPDATE application SET
  "buildPath" = './recruiter/frontend',
  "dockerContextPath" = './recruiter/frontend',
  dockerfile = './recruiter/frontend/Dockerfile',
  "customGitBuildPath" = './recruiter/frontend'
WHERE "applicationId" = 'k_p-9M7ZWEhSSf_0JusGs';

SELECT name, "buildPath", "dockerContextPath" FROM application WHERE name LIKE '%recruiter%';

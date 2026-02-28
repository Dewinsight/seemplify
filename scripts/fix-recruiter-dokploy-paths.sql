-- Fix path doubling: use . and Dockerfile when build runs from subdirectory
-- buildPath tells Dokploy where to cd; dockerContextPath and dockerfile should be relative to that
UPDATE application SET
  "buildPath" = 'recruiter/backend',
  "dockerContextPath" = '.',
  dockerfile = 'Dockerfile',
  "customGitBuildPath" = 'recruiter/backend'
WHERE "applicationId" = 'tPMolDg5OEdQUBZ4MKMFh';

UPDATE application SET
  "buildPath" = 'recruiter/frontend',
  "dockerContextPath" = '.',
  dockerfile = 'Dockerfile',
  "customGitBuildPath" = 'recruiter/frontend'
WHERE "applicationId" = 'k_p-9M7ZWEhSSf_0JusGs';

SELECT name, "buildPath", "dockerContextPath", dockerfile FROM application WHERE name LIKE '%recruiter%';

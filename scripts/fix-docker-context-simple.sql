-- Fix dockerContextPath to be just the directory (not ./recruiter/frontend)
-- This makes docker use recruiter/frontend as the build context instead of the repo root
UPDATE application SET
  "dockerContextPath" = 'recruiter/frontend'
WHERE "applicationId" = 'k_p-9M7ZWEhSSf_0JusGs';

-- Same for backend
UPDATE application SET
  "dockerContextPath" = 'recruiter/backend'
WHERE "applicationId" = 'tPMolDg5OEdQUBZ4MKMFh';

SELECT name, "buildPath", "dockerContextPath", dockerfile FROM application WHERE name LIKE '%recruiter%';

-- customGitBuildPath may be used for Git source - update it
UPDATE application SET "customGitBuildPath" = './recruiter/new/backend' WHERE "applicationId" = 'tPMolDg5OEdQUBZ4MKMFh';
UPDATE application SET "customGitBuildPath" = './recruiter/new/frontend' WHERE "applicationId" = 'k_p-9M7ZWEhSSf_0JusGs';
SELECT name, "customGitBuildPath", "buildPath", "dockerContextPath" FROM application WHERE name LIKE '%recruiter%';

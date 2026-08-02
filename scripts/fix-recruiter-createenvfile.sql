-- Disable createEnvFile for recruiter-backend and recruiter-frontend.
-- Same fix as approver: Dokploy with createEnvFile=true writes .env to a doubled path
-- (e.g. recruiter/frontend/recruiter/frontend/.env) which fails.
-- Env is provided via application.env at runtime.

UPDATE application SET "createEnvFile" = false WHERE "applicationId" = 'tPMolDg5OEdQUBZ4MKMFh';
UPDATE application SET "createEnvFile" = false WHERE "applicationId" = 'k_p-9M7ZWEhSSf_0JusGs';

SELECT name, "createEnvFile" FROM application WHERE name IN ('recruiter-backend', 'recruiter-frontend');

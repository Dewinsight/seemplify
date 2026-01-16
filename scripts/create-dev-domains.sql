-- Add domains for all dev applications
-- Run this on dokploy-postgres container

-- 1. Identity Provider Dev Domain
INSERT INTO domain ("domainId", host, path, port, https, "certificateType", "applicationId", "createdAt")
VALUES ('dom-idp-dev-001', 'auth-dev.seemplifyai.com', '/', 3000, true, 'letsencrypt', 'dev-idp-001-seemplify', '2026-01-14T14:10:00.000Z')
ON CONFLICT ("domainId") DO NOTHING;

-- 2. Recruiter Backend Dev Domain
INSERT INTO domain ("domainId", host, path, port, https, "certificateType", "applicationId", "createdAt")
VALUES ('dom-rec-be-dev-001', 'api-dev.seemplifyai.com', '/', 5001, true, 'letsencrypt', 'dev-rec-be-001-seemp', '2026-01-14T14:11:00.000Z')
ON CONFLICT ("domainId") DO NOTHING;

-- 3. Recruiter Frontend Dev Domain
INSERT INTO domain ("domainId", host, path, port, https, "certificateType", "applicationId", "createdAt")
VALUES ('dom-rec-fe-dev-001', 'app-dev.seemplifyai.com', '/', 5000, true, 'letsencrypt', 'dev-rec-fe-001-seemp', '2026-01-14T14:12:00.000Z')
ON CONFLICT ("domainId") DO NOTHING;

-- 4. Leave Backend Dev Domain
INSERT INTO domain ("domainId", host, path, port, https, "certificateType", "applicationId", "createdAt")
VALUES ('dom-lv-be-dev-001', 'api-leave-dev.seemplifyai.com', '/', 5002, true, 'letsencrypt', 'dev-lv-be-001-seemp', '2026-01-14T14:13:00.000Z')
ON CONFLICT ("domainId") DO NOTHING;

-- 5. Leave Frontend Dev Domain
INSERT INTO domain ("domainId", host, path, port, https, "certificateType", "applicationId", "createdAt")
VALUES ('dom-lv-fe-dev-001', 'leave-dev.seemplifyai.com', '/', 5003, true, 'letsencrypt', 'dev-lv-fe-001-seemp', '2026-01-14T14:14:00.000Z')
ON CONFLICT ("domainId") DO NOTHING;

-- 6. Performance Backend Dev Domain
INSERT INTO domain ("domainId", host, path, port, https, "certificateType", "applicationId", "createdAt")
VALUES ('dom-pf-be-dev-001', 'api-performance-dev.seemplifyai.com', '/', 5004, true, 'letsencrypt', 'dev-pf-be-001-seemp', '2026-01-14T14:15:00.000Z')
ON CONFLICT ("domainId") DO NOTHING;

-- 7. Performance Frontend Dev Domain
INSERT INTO domain ("domainId", host, path, port, https, "certificateType", "applicationId", "createdAt")
VALUES ('dom-pf-fe-dev-001', 'performance-dev.seemplifyai.com', '/', 5005, true, 'letsencrypt', 'dev-pf-fe-001-seemp', '2026-01-14T14:16:00.000Z')
ON CONFLICT ("domainId") DO NOTHING;

-- 8. Payroll Backend Dev Domain
INSERT INTO domain ("domainId", host, path, port, https, "certificateType", "applicationId", "createdAt")
VALUES ('dom-py-be-dev-001', 'api-payroll-dev.seemplifyai.com', '/', 5006, true, 'letsencrypt', 'dev-py-be-001-seemp', '2026-01-14T14:17:00.000Z')
ON CONFLICT ("domainId") DO NOTHING;

-- 9. Payroll Frontend Dev Domain
INSERT INTO domain ("domainId", host, path, port, https, "certificateType", "applicationId", "createdAt")
VALUES ('dom-py-fe-dev-001', 'payroll-dev.seemplifyai.com', '/', 5007, true, 'letsencrypt', 'dev-py-fe-001-seemp', '2026-01-14T14:18:00.000Z')
ON CONFLICT ("domainId") DO NOTHING;

-- Verify domains created
SELECT "domainId", host, port, "applicationId" FROM domain WHERE host LIKE '%dev%' ORDER BY host;

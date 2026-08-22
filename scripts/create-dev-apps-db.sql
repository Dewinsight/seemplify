-- Create 9 Dev Applications in Dokploy Database
-- Run this on dokploy-postgres container

-- 1. Identity Provider Dev
INSERT INTO application (
    "applicationId", name, "appName", description, 
    "sourceType", "applicationStatus", "buildType", "createdAt",
    replicas, "autoDeploy", "customGitUrl", "customGitBranch", "customGitBuildPath",
    dockerfile, "dockerContextPath", "previewHttps", "previewPort", "certificateType",
    "previewLimit", "isPreviewDeploymentsActive", "enableSubmodules", "rollbackActive",
    "previewRequireCollaboratorPermissions", "herokuVersion", "railpackVersion",
    "environmentId", "createEnvFile"
) VALUES (
    'dev-idp-001-seemplify', 'identity-provider-dev', 'identity-provider-dev-a1b2c3',
    'Identity Provider - Development Environment',
    'git', 'idle', 'dockerfile', '2026-01-14T14:00:00.000Z',
    1, true, 'https://github.com/Dewinsight/seemplify.git', 'dev', './Identityprovider',
    './Identityprovider/Dockerfile', './Identityprovider', false, 3000, 'none',
    3, false, false, false, true, '24', '0.2.2',
    'LRloZifVPbZcVc-D9jUd4', true
) ON CONFLICT ("applicationId") DO NOTHING;

-- 2. Recruiter Backend Dev
INSERT INTO application (
    "applicationId", name, "appName", description,
    "sourceType", "applicationStatus", "buildType", "createdAt",
    replicas, "autoDeploy", "customGitUrl", "customGitBranch", "customGitBuildPath",
    dockerfile, "dockerContextPath", "previewHttps", "previewPort", "certificateType",
    "previewLimit", "isPreviewDeploymentsActive", "enableSubmodules", "rollbackActive",
    "previewRequireCollaboratorPermissions", "herokuVersion", "railpackVersion",
    "environmentId", "createEnvFile"
) VALUES (
    'dev-rec-be-001-seemp', 'recruiter-backend-dev', 'recruiter-backend-dev-d4e5f6',
    'Recruiter Backend API - Development Environment',
    'git', 'idle', 'dockerfile', '2026-01-14T14:01:00.000Z',
    1, true, 'https://github.com/Dewinsight/seemplify.git', 'dev', './recruiter/backend',
    './recruiter/backend/Dockerfile', './recruiter/backend', false, 5001, 'none',
    3, false, false, false, true, '24', '0.2.2',
    'LRloZifVPbZcVc-D9jUd4', true
) ON CONFLICT ("applicationId") DO NOTHING;

-- 3. Recruiter Frontend Dev
INSERT INTO application (
    "applicationId", name, "appName", description,
    "sourceType", "applicationStatus", "buildType", "createdAt",
    replicas, "autoDeploy", "customGitUrl", "customGitBranch", "customGitBuildPath",
    dockerfile, "dockerContextPath", "previewHttps", "previewPort", "certificateType",
    "previewLimit", "isPreviewDeploymentsActive", "enableSubmodules", "rollbackActive",
    "previewRequireCollaboratorPermissions", "herokuVersion", "railpackVersion",
    "environmentId", "createEnvFile"
) VALUES (
    'dev-rec-fe-001-seemp', 'recruiter-frontend-dev', 'recruiter-frontend-dev-g7h8i9',
    'Recruiter Frontend - Development Environment',
    'git', 'idle', 'dockerfile', '2026-01-14T14:02:00.000Z',
    1, true, 'https://github.com/Dewinsight/seemplify.git', 'dev', './recruiter/frontend',
    './recruiter/frontend/Dockerfile', './recruiter/frontend', false, 5000, 'none',
    3, false, false, false, true, '24', '0.2.2',
    'LRloZifVPbZcVc-D9jUd4', true
) ON CONFLICT ("applicationId") DO NOTHING;

-- 4. Leave Backend Dev
INSERT INTO application (
    "applicationId", name, "appName", description,
    "sourceType", "applicationStatus", "buildType", "createdAt",
    replicas, "autoDeploy", "customGitUrl", "customGitBranch", "customGitBuildPath",
    dockerfile, "dockerContextPath", "previewHttps", "previewPort", "certificateType",
    "previewLimit", "isPreviewDeploymentsActive", "enableSubmodules", "rollbackActive",
    "previewRequireCollaboratorPermissions", "herokuVersion", "railpackVersion",
    "environmentId", "createEnvFile"
) VALUES (
    'dev-lv-be-001-seemp', 'leave-backend-dev', 'leave-backend-dev-j1k2l3',
    'Leave Management Backend - Development Environment',
    'git', 'idle', 'dockerfile', '2026-01-14T14:03:00.000Z',
    1, true, 'https://github.com/Dewinsight/seemplify.git', 'dev', './leave-management/backend',
    './leave-management/backend/Dockerfile', './leave-management/backend', false, 5002, 'none',
    3, false, false, false, true, '24', '0.2.2',
    'LRloZifVPbZcVc-D9jUd4', true
) ON CONFLICT ("applicationId") DO NOTHING;

-- 5. Leave Frontend Dev
INSERT INTO application (
    "applicationId", name, "appName", description,
    "sourceType", "applicationStatus", "buildType", "createdAt",
    replicas, "autoDeploy", "customGitUrl", "customGitBranch", "customGitBuildPath",
    dockerfile, "dockerContextPath", "previewHttps", "previewPort", "certificateType",
    "previewLimit", "isPreviewDeploymentsActive", "enableSubmodules", "rollbackActive",
    "previewRequireCollaboratorPermissions", "herokuVersion", "railpackVersion",
    "environmentId", "createEnvFile"
) VALUES (
    'dev-lv-fe-001-seemp', 'leave-frontend-dev', 'leave-frontend-dev-m4n5o6',
    'Leave Management Frontend - Development Environment',
    'git', 'idle', 'dockerfile', '2026-01-14T14:04:00.000Z',
    1, true, 'https://github.com/Dewinsight/seemplify.git', 'dev', './leave-management/frontend',
    './leave-management/frontend/Dockerfile', './leave-management/frontend', false, 5003, 'none',
    3, false, false, false, true, '24', '0.2.2',
    'LRloZifVPbZcVc-D9jUd4', true
) ON CONFLICT ("applicationId") DO NOTHING;

-- 6. Performance Backend Dev
INSERT INTO application (
    "applicationId", name, "appName", description,
    "sourceType", "applicationStatus", "buildType", "createdAt",
    replicas, "autoDeploy", "customGitUrl", "customGitBranch", "customGitBuildPath",
    dockerfile, "dockerContextPath", "previewHttps", "previewPort", "certificateType",
    "previewLimit", "isPreviewDeploymentsActive", "enableSubmodules", "rollbackActive",
    "previewRequireCollaboratorPermissions", "herokuVersion", "railpackVersion",
    "environmentId", "createEnvFile"
) VALUES (
    'dev-pf-be-001-seemp', 'performance-backend-dev', 'performance-backend-dev-p7q8r9',
    'Performance Management Backend - Development Environment',
    'git', 'idle', 'dockerfile', '2026-01-14T14:05:00.000Z',
    1, true, 'https://github.com/Dewinsight/seemplify.git', 'dev', './performance/backend',
    './performance/backend/Dockerfile', './performance/backend', false, 5004, 'none',
    3, false, false, false, true, '24', '0.2.2',
    'LRloZifVPbZcVc-D9jUd4', true
) ON CONFLICT ("applicationId") DO NOTHING;

-- 7. Performance Frontend Dev
INSERT INTO application (
    "applicationId", name, "appName", description,
    "sourceType", "applicationStatus", "buildType", "createdAt",
    replicas, "autoDeploy", "customGitUrl", "customGitBranch", "customGitBuildPath",
    dockerfile, "dockerContextPath", "previewHttps", "previewPort", "certificateType",
    "previewLimit", "isPreviewDeploymentsActive", "enableSubmodules", "rollbackActive",
    "previewRequireCollaboratorPermissions", "herokuVersion", "railpackVersion",
    "environmentId", "createEnvFile"
) VALUES (
    'dev-pf-fe-001-seemp', 'performance-frontend-dev', 'performance-frontend-dev-s1t2u3',
    'Performance Management Frontend - Development Environment',
    'git', 'idle', 'dockerfile', '2026-01-14T14:06:00.000Z',
    1, true, 'https://github.com/Dewinsight/seemplify.git', 'dev', './performance/frontend',
    './performance/frontend/Dockerfile', './performance/frontend', false, 5005, 'none',
    3, false, false, false, true, '24', '0.2.2',
    'LRloZifVPbZcVc-D9jUd4', true
) ON CONFLICT ("applicationId") DO NOTHING;

-- 8. Payroll Backend Dev
INSERT INTO application (
    "applicationId", name, "appName", description,
    "sourceType", "applicationStatus", "buildType", "createdAt",
    replicas, "autoDeploy", "customGitUrl", "customGitBranch", "customGitBuildPath",
    dockerfile, "dockerContextPath", "previewHttps", "previewPort", "certificateType",
    "previewLimit", "isPreviewDeploymentsActive", "enableSubmodules", "rollbackActive",
    "previewRequireCollaboratorPermissions", "herokuVersion", "railpackVersion",
    "environmentId", "createEnvFile"
) VALUES (
    'dev-py-be-001-seemp', 'payroll-backend-dev', 'payroll-backend-dev-v4w5x6',
    'Payroll Backend - Development Environment',
    'git', 'idle', 'dockerfile', '2026-01-14T14:07:00.000Z',
    1, true, 'https://github.com/Dewinsight/seemplify.git', 'dev', './payroll/backend',
    './payroll/backend/Dockerfile', './payroll/backend', false, 5006, 'none',
    3, false, false, false, true, '24', '0.2.2',
    'LRloZifVPbZcVc-D9jUd4', true
) ON CONFLICT ("applicationId") DO NOTHING;

-- 9. Payroll Frontend Dev
INSERT INTO application (
    "applicationId", name, "appName", description,
    "sourceType", "applicationStatus", "buildType", "createdAt",
    replicas, "autoDeploy", "customGitUrl", "customGitBranch", "customGitBuildPath",
    dockerfile, "dockerContextPath", "previewHttps", "previewPort", "certificateType",
    "previewLimit", "isPreviewDeploymentsActive", "enableSubmodules", "rollbackActive",
    "previewRequireCollaboratorPermissions", "herokuVersion", "railpackVersion",
    "environmentId", "createEnvFile"
) VALUES (
    'dev-py-fe-001-seemp', 'payroll-frontend-dev', 'payroll-frontend-dev-y7z8a9',
    'Payroll Frontend - Development Environment',
    'git', 'idle', 'dockerfile', '2026-01-14T14:08:00.000Z',
    1, true, 'https://github.com/Dewinsight/seemplify.git', 'dev', './payroll/frontend',
    './payroll/frontend/Dockerfile', './payroll/frontend', false, 5007, 'none',
    3, false, false, false, true, '24', '0.2.2',
    'LRloZifVPbZcVc-D9jUd4', true
) ON CONFLICT ("applicationId") DO NOTHING;

-- Verify applications created
SELECT "applicationId", name, "appName", "customGitBranch" FROM application WHERE name LIKE '%dev%';

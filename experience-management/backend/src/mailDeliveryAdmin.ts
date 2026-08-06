import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backendDir, repositoryDir } from './config.js';

type EnvMap = Map<string, string>;

export interface MailDeliveryTokenView {
  value: string | null;
  masked: string | null;
  keyId: string | null;
  fingerprint: string | null;
  source: string | null;
}

export interface MailDeliveryEnvironmentView {
  baseUrl: string | null;
  fromEmail: string | null;
  fromName: string | null;
  token: MailDeliveryTokenView;
}

export interface MailDeliveryAppView {
  id: string;
  label: string;
  localEnvPath: string;
  local: MailDeliveryEnvironmentView;
  production: {
    applicationId: string;
    applicationName: string;
    reachable: boolean;
    environment: MailDeliveryEnvironmentView | null;
    error: string | null;
  };
}

export interface MailDeliveryOverview {
  publicBaseUrl: string;
  docs: { integrationGuide: string; localServiceRepo: string };
  dokploy: {
    available: boolean;
    projectId: string | null;
    projectName: string | null;
    tokenSource: string | null;
    tokenFingerprint: string | null;
    error: string | null;
  };
  apps: MailDeliveryAppView[];
}

export interface MailDeliverySyncResult {
  publicBaseUrl: string;
  deployed: boolean;
  syncedAt: string;
  dokploy: {
    available: boolean;
    projectId: string | null;
    projectName: string | null;
    tokenSource: string | null;
  };
  apps: Array<{
    id: string;
    label: string;
    applicationId: string;
    applicationName: string;
    updated: boolean;
    deployed: boolean;
    error: string | null;
    environment: MailDeliveryEnvironmentView;
  }>;
}

interface MailDeliveryAppTarget {
  id: string;
  label: string;
  localEnvPath: string;
  tokenFilePath: string;
  dokployApplicationId: string;
  dokployApplicationName: string;
  defaultFromEmail: string;
  defaultFromName: string;
}

const DEFAULT_PUBLIC_MAIL_BASE_URL = 'https://mail-control.seemplifyai.com';
const DOKPLOY_PROJECT_ID = 'jSrhrIiOyn0eH02aRSIFY';
const DOKPLOY_PROJECT_NAME = 'seemplify';
const MAIL_API_KEYS = ['MAIL_API_BASE_URL', 'MAIL_API_TOKEN', 'MAIL_API_TOKEN_FILE', 'MAIL_FROM_EMAIL', 'MAIL_FROM_NAME'] as const;

const appTargets: MailDeliveryAppTarget[] = [
  {
    id: 'identity-provider',
    label: 'Identity Provider',
    localEnvPath: path.join(repositoryDir, 'Identityprovider', '.env'),
    tokenFilePath: path.join(repositoryDir, '.local-runtime', 'mail', 'seemplify-identity.bearer'),
    dokployApplicationId: '8e1fIo8p0MwhkMiSBtb8U',
    dokployApplicationName: 'identity-provider',
    defaultFromEmail: 'no-reply@seemplifyai.com',
    defaultFromName: 'Seemplify Identity'
  },
  {
    id: 'recruiter-backend',
    label: 'Recruiter Backend',
    localEnvPath: path.join(repositoryDir, 'recruiter', 'backend', '.env'),
    tokenFilePath: path.join(repositoryDir, '.local-runtime', 'mail', 'recruiter.bearer'),
    dokployApplicationId: 'tPMolDg5OEdQUBZ4MKMFh',
    dokployApplicationName: 'recruiter-backend',
    defaultFromEmail: 'no-reply@seemplifyai.com',
    defaultFromName: 'Seemplify Recruiter'
  },
  {
    id: 'leave-backend',
    label: 'Leave Backend',
    localEnvPath: path.join(repositoryDir, 'leave-management', 'backend', '.env'),
    tokenFilePath: path.join(repositoryDir, '.local-runtime', 'mail', 'leave-management.bearer'),
    dokployApplicationId: 'OdL2J825IGp_Ce-JpO_kV',
    dokployApplicationName: 'leave-backend',
    defaultFromEmail: 'no-reply@seemplifyai.com',
    defaultFromName: 'Seemplify Leave'
  },
  {
    id: 'performance-backend',
    label: 'Performance Backend',
    localEnvPath: path.join(repositoryDir, 'performance', 'backend', '.env'),
    tokenFilePath: path.join(repositoryDir, '.local-runtime', 'mail', 'performance.bearer'),
    dokployApplicationId: 'tHLfC6JuJA5p6hTnNon6h',
    dokployApplicationName: 'performance-backend',
    defaultFromEmail: 'no-reply@seemplifyai.com',
    defaultFromName: 'Seemplify Performance'
  },
  {
    id: 'payroll-backend',
    label: 'Payroll Backend',
    localEnvPath: path.join(repositoryDir, 'payroll', 'backend', '.env'),
    tokenFilePath: path.join(repositoryDir, '.local-runtime', 'mail', 'payroll.bearer'),
    dokployApplicationId: 'fCXCiEFV3luBmNyUOo1wD',
    dokployApplicationName: 'payroll-backend',
    defaultFromEmail: 'no-reply@seemplifyai.com',
    defaultFromName: 'Seemplify Payroll'
  },
  {
    id: 'time-attendance-backend',
    label: 'Time Attendance Backend',
    localEnvPath: path.join(repositoryDir, 'time-attendance', 'backend', '.env'),
    tokenFilePath: path.join(repositoryDir, '.local-runtime', 'mail', 'time-attendance.bearer'),
    dokployApplicationId: 'gmBjqWd6pQKSWqfBIMNyL',
    dokployApplicationName: 'time-attendance-backend',
    defaultFromEmail: 'no-reply@seemplifyai.com',
    defaultFromName: 'Seemplify Time & Attendance'
  },
  {
    id: 'seemplify-learning',
    label: 'Seemplify Learning',
    localEnvPath: path.join(repositoryDir, 'seemplify-learning', '.env'),
    tokenFilePath: path.join(repositoryDir, '.local-runtime', 'mail', 'seemplify-learning.bearer'),
    dokployApplicationId: 'ZJwveqext--O-giMdAbbr',
    dokployApplicationName: 'seemplify-learning',
    defaultFromEmail: 'no-reply@seemplifyai.com',
    defaultFromName: 'Seemplify Learning'
  }
];

function parseEnvText(value: string) {
  const values = new Map<string, string>();
  const passthrough: string[] = [];
  for (const rawLine of String(value || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      passthrough.push(rawLine);
      continue;
    }
    const separator = rawLine.indexOf('=');
    if (separator < 1) {
      passthrough.push(rawLine);
      continue;
    }
    values.set(rawLine.slice(0, separator), rawLine.slice(separator + 1));
  }
  return { values, passthrough };
}

function serializeEnv(values: EnvMap, passthrough: string[]) {
  return [...Array.from(values, ([key, value]) => `${key}=${value}`), ...passthrough].join('\n');
}

function safeReadFile(filePath: string) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function safeReadTrimmed(filePath: string) {
  return safeReadFile(filePath).trim();
}

function normalizeBaseUrl(value: string) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function tokenView(value: string, source: string | null): MailDeliveryTokenView {
  const token = String(value || '').trim();
  if (!token) return { value: null, masked: null, keyId: null, fingerprint: null, source };
  const keyId = token.includes('.') ? token.slice(0, token.indexOf('.')) : token.slice(0, 12);
  const fingerprint = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  const secretLength = Math.max(8, token.length - keyId.length - (token.includes('.') ? 1 : 0));
  return {
    value: token,
    masked: `${keyId}${token.includes('.') ? '.' : ''}${'•'.repeat(secretLength)}`,
    keyId,
    fingerprint,
    source
  };
}

function currentEnvironment(target: MailDeliveryAppTarget) {
  const parsed = parseEnvText(safeReadFile(target.localEnvPath));
  const tokenFile = String(parsed.values.get('MAIL_API_TOKEN_FILE') || '').trim();
  const tokenFilePath = tokenFile
    ? path.resolve(path.dirname(target.localEnvPath), tokenFile)
    : target.tokenFilePath;
  const fileToken = safeReadTrimmed(tokenFilePath);
  const inlineToken = String(parsed.values.get('MAIL_API_TOKEN') || '').trim();
  const token = inlineToken || fileToken;
  const tokenSource = inlineToken ? target.localEnvPath : fileToken ? tokenFilePath : null;
  return {
    baseUrl: normalizeBaseUrl(String(parsed.values.get('MAIL_API_BASE_URL') || '')),
    fromEmail: String(parsed.values.get('MAIL_FROM_EMAIL') || '').trim() || target.defaultFromEmail,
    fromName: String(parsed.values.get('MAIL_FROM_NAME') || '').trim() || target.defaultFromName,
    token: tokenView(token, tokenSource)
  } satisfies MailDeliveryEnvironmentView;
}

function extractDokployTokenCandidates() {
  const files = [
    path.join(repositoryDir, 'access', 'ACCESS-GUIDE.md'),
    path.join(repositoryDir, 'access', 'DOKPLOY-KEY-FIX-COMPLETE.md'),
    path.join(repositoryDir, 'access', 'DEPLOYMENT-FIX-SUMMARY.md'),
    path.join(repositoryDir, 'access', 'GITHUB-ACTIONS-CONFIG.md'),
    path.join(repositoryDir, 'approver', 'complete-deployment-setup.ps1')
  ];
  const patterns = [
    /gh secret set DOKPLOY_TOKEN --body "([^"]+)"/gu,
    /DOKPLOY_TOKEN\s*=\s*'([^']+)'/gu,
    /\b(github-actions-[A-Za-z0-9]+)\b/gu,
    /\b(sk_dokploy_[A-Za-z0-9]+)\b/gu
  ];
  const candidates = new Map<string, string>();
  for (const filePath of files) {
    const text = safeReadFile(filePath);
    if (!text) continue;
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const candidate = String(match[1] || '').trim();
        if (!candidate || /YOUR_NEW_API_KEY_HERE|your-api-key-here|<your/i.test(candidate)) continue;
        if (!candidates.has(candidate)) candidates.set(candidate, filePath);
      }
    }
  }
  return candidates;
}

async function dokployRequest<T>(token: string, endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`http://4.180.153.209:3000/api/${endpoint}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': token,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Dokploy request ${endpoint} failed with HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function resolveDokployAccess() {
  const candidates = extractDokployTokenCandidates();
  for (const [token, source] of candidates.entries()) {
    try {
      const project = await dokployRequest<any>(token, `project.one?projectId=${encodeURIComponent(DOKPLOY_PROJECT_ID)}`);
      return {
        token,
        tokenSource: source,
        projectId: String(project.projectId || DOKPLOY_PROJECT_ID),
        projectName: String(project.name || DOKPLOY_PROJECT_NAME)
      };
    } catch {
      continue;
    }
  }
  throw new Error('No working Dokploy API token could be resolved from the local access documentation.');
}

function parseProductionMailEnvironment(envText: string) {
  const parsed = parseEnvText(envText);
  const token = String(parsed.values.get('MAIL_API_TOKEN') || '').trim();
  return {
    baseUrl: normalizeBaseUrl(String(parsed.values.get('MAIL_API_BASE_URL') || '')),
    fromEmail: String(parsed.values.get('MAIL_FROM_EMAIL') || '').trim() || null,
    fromName: String(parsed.values.get('MAIL_FROM_NAME') || '').trim() || null,
    token: tokenView(token, 'Dokploy environment')
  } satisfies MailDeliveryEnvironmentView;
}

function desiredProductionMailEnvironment(target: MailDeliveryAppTarget, publicBaseUrl: string) {
  const local = currentEnvironment(target);
  return {
    baseUrl: normalizeBaseUrl(publicBaseUrl) || DEFAULT_PUBLIC_MAIL_BASE_URL,
    fromEmail: local.fromEmail || target.defaultFromEmail,
    fromName: local.fromName || target.defaultFromName,
    token: local.token
  } satisfies MailDeliveryEnvironmentView;
}

function applyMailEnvironment(envText: string, nextEnvironment: MailDeliveryEnvironmentView) {
  const parsed = parseEnvText(envText);
  for (const key of MAIL_API_KEYS) parsed.values.delete(key);
  if (nextEnvironment.baseUrl) parsed.values.set('MAIL_API_BASE_URL', nextEnvironment.baseUrl);
  if (nextEnvironment.token.value) parsed.values.set('MAIL_API_TOKEN', nextEnvironment.token.value);
  if (nextEnvironment.fromEmail) parsed.values.set('MAIL_FROM_EMAIL', nextEnvironment.fromEmail);
  if (nextEnvironment.fromName) parsed.values.set('MAIL_FROM_NAME', nextEnvironment.fromName);
  return serializeEnv(parsed.values, parsed.passthrough);
}

function sameMailEnvironment(left: MailDeliveryEnvironmentView, right: MailDeliveryEnvironmentView) {
  return left.baseUrl === right.baseUrl
    && left.fromEmail === right.fromEmail
    && left.fromName === right.fromName
    && left.token.value === right.token.value;
}

export async function getMailDeliveryOverview(): Promise<MailDeliveryOverview> {
  let dokploy: MailDeliveryOverview['dokploy'] = {
    available: false,
    projectId: null,
    projectName: null,
    tokenSource: null,
    tokenFingerprint: null,
    error: null
  };

  let productionEnvironments = new Map<string, { applicationName: string; environment: MailDeliveryEnvironmentView | null; error: string | null; reachable: boolean }>();
  try {
    const access = await resolveDokployAccess();
    dokploy = {
      available: true,
      projectId: access.projectId,
      projectName: access.projectName,
      tokenSource: access.tokenSource,
      tokenFingerprint: crypto.createHash('sha256').update(access.token).digest('hex').slice(0, 12),
      error: null
    };
    for (const target of appTargets) {
      try {
        const app = await dokployRequest<any>(access.token, `application.one?applicationId=${encodeURIComponent(target.dokployApplicationId)}`);
        productionEnvironments.set(target.id, {
          applicationName: String(app.name || target.dokployApplicationName),
          environment: parseProductionMailEnvironment(String(app.env || '')),
          error: null,
          reachable: true
        });
      } catch (error) {
        productionEnvironments.set(target.id, {
          applicationName: target.dokployApplicationName,
          environment: null,
          error: error instanceof Error ? error.message : 'Dokploy application lookup failed.',
          reachable: false
        });
      }
    }
  } catch (error) {
    dokploy.error = error instanceof Error ? error.message : 'Dokploy access is unavailable.';
  }

  return {
    publicBaseUrl: DEFAULT_PUBLIC_MAIL_BASE_URL,
    docs: {
      integrationGuide: path.join(repositoryDir, 'docs', 'TRANSACTIONAL-EMAIL.md'),
      localServiceRepo: path.join(path.dirname(repositoryDir), 'crm', 'Xplorer-crm', 'platform', 'email')
    },
    dokploy,
    apps: appTargets.map((target) => {
      const production = productionEnvironments.get(target.id);
      return {
        id: target.id,
        label: target.label,
        localEnvPath: target.localEnvPath,
        local: currentEnvironment(target),
        production: {
          applicationId: target.dokployApplicationId,
          applicationName: production?.applicationName || target.dokployApplicationName,
          reachable: production?.reachable || false,
          environment: production?.environment || null,
          error: production?.error || null
        }
      };
    })
  };
}

export async function syncMailDeliveryEnvironment(options: { publicBaseUrl?: string; deploy?: boolean } = {}): Promise<MailDeliverySyncResult> {
  const access = await resolveDokployAccess();
  const publicBaseUrl = normalizeBaseUrl(options.publicBaseUrl || '') || DEFAULT_PUBLIC_MAIL_BASE_URL;
  const deploy = options.deploy !== false;
  const syncedAt = new Date().toISOString();
  const results: MailDeliverySyncResult['apps'] = [];

  for (const target of appTargets) {
    const desired = desiredProductionMailEnvironment(target, publicBaseUrl);
    if (!desired.token.value) {
      results.push({
        id: target.id,
        label: target.label,
        applicationId: target.dokployApplicationId,
        applicationName: target.dokployApplicationName,
        updated: false,
        deployed: false,
        error: `No local mail bearer token could be resolved for ${target.label}.`,
        environment: desired
      });
      continue;
    }

    try {
      const application = await dokployRequest<any>(access.token, `application.one?applicationId=${encodeURIComponent(target.dokployApplicationId)}`);
      const current = parseProductionMailEnvironment(String(application.env || ''));
      const nextEnv = applyMailEnvironment(String(application.env || ''), desired);
      const updated = !sameMailEnvironment(current, desired);

      if (updated) {
        await dokployRequest(access.token, 'application.saveEnvironment', {
          method: 'POST',
          body: JSON.stringify({
            applicationId: target.dokployApplicationId,
            env: nextEnv,
            buildArgs: application.buildArgs || '',
            buildSecrets: application.buildSecrets || '',
            createEnvFile: application.createEnvFile === true
          })
        });
      }

      if (deploy) {
        await dokployRequest(access.token, 'application.deploy', {
          method: 'POST',
          body: JSON.stringify({ applicationId: target.dokployApplicationId })
        });
      }

      results.push({
        id: target.id,
        label: target.label,
        applicationId: target.dokployApplicationId,
        applicationName: String(application.name || target.dokployApplicationName),
        updated,
        deployed: deploy,
        error: null,
        environment: desired
      });
    } catch (error) {
      results.push({
        id: target.id,
        label: target.label,
        applicationId: target.dokployApplicationId,
        applicationName: target.dokployApplicationName,
        updated: false,
        deployed: false,
        error: error instanceof Error ? error.message : 'Dokploy sync failed.',
        environment: desired
      });
    }
  }

  return {
    publicBaseUrl,
    deployed: deploy,
    syncedAt,
    dokploy: {
      available: true,
      projectId: access.projectId,
      projectName: access.projectName,
      tokenSource: access.tokenSource
    },
    apps: results
  };
}

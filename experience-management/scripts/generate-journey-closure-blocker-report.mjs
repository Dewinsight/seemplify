import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const operationsDirectory = path.join(workspaceRoot, 'docs', 'journey-management', 'operations');
const outputJsonPath = path.join(operationsDirectory, 'latest-journey-closure-blockers-report.json');
const outputMarkdownPath = path.join(operationsDirectory, 'latest-journey-closure-blockers-report.md');
const sdkReadinessJsonPath = path.join(operationsDirectory, 'latest-sdk-publication-readiness-report.json');
const releaseGateJsonPath = path.join(operationsDirectory, 'latest-connected-journey-release-gate-report.json');
const dogfoodJsonPath = path.join(workspaceRoot, 'docs', 'journey-management', 'dogfood', 'latest-activation-report.json');
const generatedAt = new Date().toISOString();
const displayDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC'
}).format(new Date());

function run(command, args, { cwd = workspaceRoot } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim()
  };
}

function runNodeScript(relativeScriptPath, { cwd = workspaceRoot } = {}) {
  const result = spawnSync(process.execPath, [path.join(workspaceRoot, relativeScriptPath)], {
    cwd,
    encoding: 'utf8',
    shell: false
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim()
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function safeReadJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

mkdirSync(operationsDirectory, { recursive: true });

const validateResult = run('npm', ['run', 'validate:journey-plan']);
const sdkReadinessRefresh = runNodeScript(path.join('scripts', 'generate-sdk-publication-readiness-report.mjs'));
const releaseGateRefresh = run('npm', ['run', 'report:journey:release-gate']);
const dogfoodRefresh = run('npm', ['run', 'report:journey-dogfood']);

const validation = validateResult.ok ? JSON.parse(validateResult.stdout.split(/\r?\n/u).at(-1) ?? '{}') : null;
const sdkReadiness = safeReadJson(sdkReadinessJsonPath);
const releaseGate = safeReadJson(releaseGateJsonPath);
const dogfood = safeReadJson(dogfoodJsonPath);
const sdkReadinessArtifactAvailable = Boolean(sdkReadiness?.generatedAt);

const dogfoodSummary = dogfood?.summary ?? {};
const sdkRepoSide = sdkReadiness?.repoSide ?? {};
const sdkPublishPreflight = sdkReadiness?.publishPreflight ?? {};
const connectedJourneyFamily = Array.isArray(releaseGate?.blockerStatuses)
  ? releaseGate.blockerStatuses.filter((item) => item?.open)
  : [];

const blockerFamilies = [
  {
    id: 'connected_journey_release_gate',
    title: 'Connected-journey release gate',
    status: 'open',
    scope: ['programme', 'sdk_publication'],
    currentEvidence: {
      releaseGateArtifactGeneratedAt: releaseGate?.generatedAt ?? null,
      releaseGateOk: Boolean(releaseGate?.ok),
      openConnectedJourneyBlockers: connectedJourneyFamily.map((item) => item.id),
      openConnectedJourneyBlockerCount: connectedJourneyFamily.length
    },
    missingProof: [
      'production-scale retained reprojection and performance proof',
      'ratified security/privacy/operations approval',
      'sustained load, SLO, and failover evidence',
      'signed connected-journey release signoff'
    ]
  },
  {
    id: 'seemplify_activation_dogfood',
    title: 'Seemplify activation dogfood and rollout evidence',
    status: 'open',
    scope: ['programme', 'sdk_publication'],
    currentEvidence: {
      dogfoodArtifactGeneratedAt: dogfood?.generatedAt ?? null,
      accounts: Number(dogfoodSummary.users ?? 0),
      onboardingCompleted: Number(dogfoodSummary.withOnboardingCompleted ?? 0),
      chatGptConnected: Number(dogfoodSummary.withChatGptConnected ?? 0),
      chatGptSelected: Number(dogfoodSummary.withChatGptSelected ?? 0),
      journeyCreated: Number(dogfoodSummary.withJourneyCreated ?? 0)
    },
    missingProof: [
      'full end-to-end dogfood run with fresh ChatGPT/runtime milestones',
      'non-zero journey activity in sampled evidence',
      'signed rollout and release signoff sufficient for X-09 and SDK publication'
    ]
  },
  {
    id: 'cross_cutting_governance_privacy_runbooks',
    title: 'Cross-cutting governance, privacy, telemetry, and runbooks',
    status: 'open',
    scope: ['programme', 'sdk_publication'],
    currentEvidence: {
      validation: validation ? {
        valid: Boolean(validation.valid),
        requirements: Number(validation.requirements ?? 0),
        evidenceRecords: Number(validation.evidenceRecords ?? 0),
        states: validation.states ?? {}
      } : null,
      proofChainIds: ['X-02', 'X-05', 'X-08', 'X-09', 'X-10']
    },
    missingProof: [
      'route-by-route journeys.* capability enforcement',
      'privacy/DPIA/retention controls',
      'ratified telemetry, SLOs, and runbooks',
      'signed rollout gates',
      'published verified operator/developer/customer documentation'
    ]
  },
  {
    id: 'sdk_repo_workflow_publish_readiness',
    title: 'SDK repo/workflow publish readiness',
    status: 'open',
    scope: ['sdk_publication'],
    currentEvidence: {
      readinessArtifactGeneratedAt: sdkReadiness?.generatedAt ?? null,
      landingPreflightOk: Boolean(sdkRepoSide.landingPreflightOk),
      requiredFilesMissingOnMain: sdkRepoSide.requiredFilesMissingOnMain ?? [],
      committedMainHeadDiffs: Number(sdkRepoSide.committedMainHeadDiffs ?? 0),
      workingTreeSdkPublishStateEntries: Number(sdkRepoSide.workingTreeSdkPublishStateEntries ?? 0),
      repositoryWorkflowBlockers: sdkPublishPreflight.repositoryWorkflowBlockers ?? []
    },
    missingProof: [
      'publish workflow intentionally enabled only after release gates are satisfied'
    ]
  },
  {
    id: 'npm_auth_and_scope_readiness',
    title: 'npm authentication and scope readiness',
    status: 'open',
    scope: ['sdk_publication'],
    currentEvidence: {
      externalSetupBlockers: sdkPublishPreflight.externalSetupBlockers ?? [],
      workstationLimitations: sdkPublishPreflight.workstationLimitations ?? []
    },
    missingProof: [
      'npm whoami success on the publishing machine',
      '@seemplify organisation ownership/readiness confirmation',
      'trusted publisher configuration for the exact repository/workflow/environment',
      'successful protected publish run'
    ]
  }
];

const report = {
  ok: true,
  generatedAt,
  displayDate,
  inputs: {
    validateJourneyPlan: {
      ok: validateResult.ok,
      status: validateResult.status
    },
    sdkPublicationReadinessRefresh: {
      ok: sdkReadinessRefresh.ok,
      status: sdkReadinessRefresh.status
    },
    releaseGateRefresh: {
      ok: releaseGateRefresh.ok,
      status: releaseGateRefresh.status
    },
    dogfoodRefresh: {
      ok: dogfoodRefresh.ok,
      status: dogfoodRefresh.status
    }
  },
  blockerFamilies
};

const markdown = `# Journey closure blocker report

Generated at: ${generatedAt}

## Summary

- Date: ${displayDate}
- Journey-plan validation: ${validateResult.ok ? 'passed' : 'failed'}
- SDK publication-readiness artifact refresh: ${sdkReadinessRefresh.ok && sdkReadinessArtifactAvailable ? 'passed' : 'failed'}
- Dogfood artifact refresh: ${dogfoodRefresh.ok ? 'passed' : 'failed'}
- Open blocker families: ${blockerFamilies.length}

## Blocker families

${blockerFamilies.map((family) => `### ${family.title}

- ID: ${family.id}
- Scope: ${family.scope.join(', ')}
- Status: ${family.status}
- Current evidence:
${Object.entries(family.currentEvidence).map(([key, value]) => `  - ${key}: ${Array.isArray(value) ? (value.length ? value.join('; ') : 'none') : value === null ? 'unavailable' : typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join('\n')}
- Missing proof:
${family.missingProof.map((item) => `  - ${item}`).join('\n')}
`).join('\n')}
`;

writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(outputMarkdownPath, markdown, 'utf8');

console.log(JSON.stringify({
  ok: true,
  generatedAt,
  outputJsonPath,
  outputMarkdownPath,
  blockerFamilies: blockerFamilies.length
}));

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTypeScript(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', ...relativePath.split('/')), 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const loaded = { exports: {} }
  new Function('exports', 'module', transpiled.outputText)(loaded.exports, loaded)
  return loaded.exports
}

const progress = loadTypeScript('utils/cvUploadProgress.ts')

test('upload history is bounded, deduplicated, and expires stale browser records', () => {
  const now = Date.parse('2026-08-09T12:00:00.000Z')
  const uploads = Array.from({ length: 11 }, (_, index) => ({
    batchId: index === 1 ? 'duplicate' : `batch-${index}`,
    createdAt: new Date(now - index * 60_000).toISOString(),
    files: [{ name: `${index}.pdf`, size: index }]
  }))
  uploads[0].batchId = 'duplicate'
  uploads.push({ batchId: 'expired', createdAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(), files: [] })
  const parsed = progress.parseUploadHistory(JSON.stringify({ version: 1, uploads }), now)
  assert.equal(parsed.length, 8)
  assert.equal(parsed.filter((upload) => upload.batchId === 'duplicate').length, 1)
  assert.equal(parsed.some((upload) => upload.batchId === 'expired'), false)
})

test('duplicate filenames reconcile against distinct rich jobs without collapsing rows', () => {
  const rows = progress.reconcileUploadFiles([
    { name: 'candidate.pdf', size: 100 },
    { name: 'candidate.pdf', size: 200 }
  ], {
    state: 'completed',
    jobs: [
      { jobId: 'cv-1', state: 'completed', stage: 'completed', file: { name: 'candidate.pdf' }, candidateId: 'candidate-1' },
      { jobId: 'cv-2', state: 'failed', stage: 'failed', file: { name: 'candidate.pdf' }, error: { message: 'Unreadable text' }, retry: { available: true } }
    ]
  })
  assert.deepEqual(rows.map((row) => [row.jobId, row.state, row.candidateId, row.error]), [
    ['cv-1', 'completed', 'candidate-1', null],
    ['cv-2', 'failed', null, 'Unreadable text']
  ])
})

test('current analyzing stage stays active while proved prior stages are done and later stages stay pending', () => {
  const timeline = progress.buildCvStageTimeline({
    key: 'cv-1',
    fileName: 'candidate.pdf',
    jobId: 'cv-1',
    state: 'processing',
    stage: 'analyzing',
    progress: 60,
    storageProvider: 'azure-blob',
    canRetry: false,
    detailIsExact: true,
    receivedAt: '2026-08-09T10:00:00.000Z',
    storedAt: '2026-08-09T10:00:01.000Z',
    cloudStoredAt: '2026-08-09T10:00:02.000Z',
    textExtractedAt: '2026-08-09T10:00:03.000Z',
    stageHistory: [
      { stage: 'received', at: '2026-08-09T10:00:00.000Z' },
      { stage: 'uploading', at: '2026-08-09T10:00:01.000Z' },
      { stage: 'extracting', at: '2026-08-09T10:00:02.000Z' },
      { stage: 'analyzing', at: '2026-08-09T10:00:04.000Z' }
    ]
  })
  assert.deepEqual(timeline.map(({ label, state }) => [label, state]), [
    ['Received', 'done'],
    ['Secure storage', 'done'],
    ['Azure Blob Storage', 'done'],
    ['Text extraction', 'done'],
    ['AI analysis', 'active'],
    ['Profile creation', 'pending'],
    ['Complete', 'pending']
  ])
})

test('candidate CV progress labels every operational state and detailed processing stage', () => {
  const cases = [
    [{ cvIngestionState: 'not_received' }, 'CV not received'],
    [{ cvIngestionState: 'queued' }, 'Queued for processing'],
    [{ cvIngestionState: 'processing', cvProcessingStage: 'stored' }, 'CV stored'],
    [{ cvIngestionState: 'processing', cvProcessingStage: 'uploading' }, 'Storing CV'],
    [{ cvIngestionState: 'processing', cvProcessingStage: 'extracting' }, 'Extracting CV'],
    [{ cvIngestionState: 'processing', cvProcessingStage: 'analyzing' }, 'Analyzing CV'],
    [{ cvIngestionState: 'processing', cvProcessingStage: 'profile_creation' }, 'Creating profile'],
    [{ cvIngestionState: 'failed', cvProcessingStage: 'failed' }, 'CV processing failed'],
    [{ cvIngestionState: 'waiting' }, 'Analysis waiting'],
    [{ cvIngestionState: 'waiting_for_chatgpt' }, 'Analysis waiting'],
    [{ cvIngestionState: 'cancelled', cvProcessingStage: 'failed' }, 'CV processing cancelled'],
    [{ cvIngestionState: 'deleted' }, 'CV processing cancelled'],
    [{ cvIngestionState: 'completed', cvProcessingStage: 'completed' }, 'Analysis complete']
  ]
  cases.forEach(([metadata, expected]) => assert.equal(progress.candidateCvProgressView(metadata).label, expected))
})

test('unknown failed stages stay truthful and legacy incomplete analysis remains visible', () => {
  const timeline = progress.buildCvStageTimeline({
    key: 'cv-unknown',
    fileName: 'unknown.pdf',
    state: 'failed',
    stage: 'failed',
    progress: null,
    errorAt: '2026-08-09T10:00:00.000Z',
    stageHistory: [],
    canRetry: true,
    detailIsExact: true
  })
  assert.equal(timeline.some((item) => item.label === 'Received' && item.state === 'failed'), false)
  assert.equal(timeline.some((item) => item.label === 'Failed (stage not reported)' && item.state === 'failed'), true)

  assert.deepEqual(progress.candidateCvProgressView({
    uploadSuccess: true,
    parseSuccess: true,
    aiSuccess: false
  }), {
    label: 'Analysis incomplete',
    tone: 'warning',
    active: false
  })
})

test('frontend contracts use canonical retry, durable acceptance, and interview-bound resume access', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'candidateService.ts'), 'utf8')
  const publicForm = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'public-job-application-form.tsx'), 'utf8')
  const feedback = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'feedback', '[interviewId]', 'page.tsx'), 'utf8')
  const apiConfig = fs.readFileSync(path.join(__dirname, '..', 'services', 'apiConfig.ts'), 'utf8')
  const interviewService = fs.readFileSync(path.join(__dirname, '..', 'services', 'interviewService.ts'), 'utf8')
  const candidateList = fs.readFileSync(path.join(__dirname, '..', 'app', 'candidates', 'page.tsx'), 'utf8')
  const bulkUpload = fs.readFileSync(path.join(__dirname, '..', 'app', 'bulk-upload', 'page.tsx'), 'utf8')
  const recruiterProcessing = fs.readFileSync(path.join(__dirname, '..', 'app', 'cv-processing', 'page.tsx'), 'utf8')
  const adminProcessing = fs.readFileSync(path.join(__dirname, '..', 'app', 'admin', 'cv-processing', 'page.tsx'), 'utf8')
  assert.match(service, /\/api\/cv-ingestion\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/retry/)
  assert.doesNotMatch(service, /fallbackPayload/)
  assert.match(service, /'Idempotency-Key': options\.idempotencyKey/)
  assert.match(service, /\/api\/cv-ingestion\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/replace/)
  assert.match(service, /body\.append\('expectedPriorJobId', jobId\)/)
  assert.equal((service.match(/\.status = response\.status/g) || []).length >= 4, true)
  assert.match(service, /'X-CV-Status-Token': accepted\.statusToken/)
  assert.match(service, /CVProcessingPendingError/)
  assert.match(service, /options\.signal/)
  assert.match(service, /document\.visibilityState !== 'visible'/)
  assert.match(service, /Date\.now\(\) >= deadline/)
  assert.doesNotMatch(service, /statusUrl}\?token=/)
  assert.match(publicForm, /await secureCvForBackgroundProcessing/)
  assert.match(publicForm, /skipAuth: true/)
  assert.match(publicForm, /<Dialog open/)
  assert.match(publicForm, /application\/octet-stream/)
  assert.match(publicForm, /onDrop=/)
  assert.match(publicForm, /aria-label={`Remove \$\{uploadedFile\.name\}`}/)
  assert.doesNotMatch(publicForm, /\/shortlist`/)
  assert.match(publicForm, /response\.status !== 202/)
  assert.match(publicForm, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(publicForm, /'X-Public-Application-Token': capabilityToken/)
  assert.match(publicForm, /'X-Public-Job-Id': jobId/)
  assert.match(publicForm, /'X-Public-Candidate-Id': candidateId/)
  assert.match(publicForm, /sessionStorage\.setItem\(attemptStorageKey/)
  assert.match(publicForm, /clearApplicationAttempt\(\)/)
  assert.match(feedback, /public\/interviews\/\$\{encodeURIComponent\(interviewId\)\}\/candidates/)
  assert.match(feedback, /searchParams\.get\('accessToken'\)/)
  assert.match(feedback, /sessionStorage\.setItem\(feedbackTokenStorageKey/)
  assert.match(feedback, /sessionStorage\.getItem\(feedbackTokenStorageKey\)/)
  assert.match(feedback, /sessionStorage\.removeItem\(feedbackTokenStorageKey\)/)
  assert.match(feedback, /if \(!feedbackAccessResolved\) return/)
  assert.match(feedback, /url\.searchParams\.delete\('accessToken'\)/)
  assert.match(feedback, /window\.history\.replaceState/)
  assert.match(feedback, /'X-Public-Feedback-Token': feedbackAccessToken/)
  assert.match(feedback, /const isAuthenticatedInternalAccess = isInternalUser && !feedbackAccessToken/)
  assert.match(feedback, /if \(isAuthenticatedInternalAccess\)/)
  assert.match(feedback, /addBulkPublicFeedback\(interviewId, bulkFeedbackData, feedbackAccessToken \|\| undefined\)/)
  assert.match(feedback, /resumeAvailable: boolean/)
  assert.match(feedback, /candidateInfo\?\.resumeAvailable/)
  assert.doesNotMatch(feedback, /candidateInfo\?\.resumeUrl/)
  assert.doesNotMatch(feedback, /originalUrl/)
  assert.equal((interviewService.match(/'X-Public-Feedback-Token': accessToken/g) || []).length, 5)
  assert.match(apiConfig, /if \(skipAuth\) throw err/)
  assert.doesNotMatch(apiConfig, /else if \(is404\)/)
  assert.match(recruiterProcessing, /detailPollInFlight[\s\S]*getCVIngestionJob\(selectedJobId\)/)
  assert.match(adminProcessing, /detailPollInFlight[\s\S]*getAdminCVIngestionJob\(selectedJobId\)/)
  assert.match(recruiterProcessing, /attempt\.finishedAt[\s\S]*attempt\.errorMessage/)
  assert.match(adminProcessing, /attempt\.finishedAt[\s\S]*attempt\.errorMessage/)
  assert.match(candidateList, /href="\/cv-processing"/)
  assert.match(candidateList, />\s*CV processing\s*</)
  assert.match(candidateList, /View CV processing/)
  assert.match(recruiterProcessing, /One-at-a-time CV analysis/)
  assert.match(recruiterProcessing, /CVs are analysed sequentially: one runs while the rest remain in the queue\./)
  assert.match(recruiterProcessing, /Re-analysis running/)
  assert.match(recruiterProcessing, /Re-analysis queued/)
  assert.match(candidateList, /hasActiveCvProcessing/)
  assert.match(candidateList, /setRetryEligibleJobIds/)
  assert.match(candidateList, /nextExpiry[\s\S]*window\.setTimeout/)
  assert.doesNotMatch(candidateList, /setInterval\(\(\) => void refreshEligibility/)
  assert.match(candidateList, /detail\.retry\?\.replacementAvailable === true/)
  assert.match(candidateList, /keyConflict[\s\S]*localStorage\.removeItem\(storageKey\)/)
  assert.match(bulkUpload, /getCVIngestionJobs\(\{ source: "bulk", page: 1, limit: 100 \}\)/)
  assert.match(bulkUpload, /persistUploads\(nextUploads\)[\s\S]*if \(nextUploads\.length > 0\)/)
  assert.match(bulkUpload, /keyConflict[\s\S]*sessionStorage\.removeItem\(attemptStorageKey\)/)
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'app', 'api', 'candidates', 'public', '[id]', 'route.ts')), false)
})

test('public application proxies preserve capabilities and stream CVs without buffering', () => {
  const uploadProxy = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'candidates', 'public', 'upload-cv', 'route.ts'), 'utf8')
  const shortlistProxy = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'jobs', 'public', '[jobId]', 'shortlist', 'route.ts'), 'utf8')
  assert.match(uploadProxy, /body: request\.body/)
  assert.match(uploadProxy, /duplex: 'half'/)
  assert.doesNotMatch(uploadProxy, /request\.formData\(\)/)
  assert.match(uploadProxy, /'X-Public-Application-Token': capability/)
  assert.match(uploadProxy, /'X-Public-Job-Id': jobId/)
  assert.match(uploadProxy, /'X-Public-Candidate-Id': candidateId/)
  assert.match(shortlistProxy, /X-Public-Application-Token/)
})

test('operational views are server-backed, bounded, accessible, and cancellation-aware', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'cvIngestionService.ts'), 'utf8')
  const recruiterHistory = fs.readFileSync(path.join(__dirname, '..', 'app', 'cv-processing', 'page.tsx'), 'utf8')
  const adminHistory = fs.readFileSync(path.join(__dirname, '..', 'app', 'admin', 'cv-processing', 'page.tsx'), 'utf8')
  const timeline = fs.readFileSync(path.join(__dirname, '..', 'components', 'cv-processing', 'CvProcessingTimeline.tsx'), 'utf8')
  const privateUpload = fs.readFileSync(path.join(__dirname, '..', 'app', 'candidates', 'new', 'page.tsx'), 'utf8')
  assert.match(service, /\/api\/cv-ingestion\/jobs/)
  assert.match(service, /\/api\/admin\/cv-ingestion\/organizations/)
  assert.doesNotMatch(service, /retainedIndefinitely/)
  assert.match(recruiterHistory, /aria-label={`View processing details/)
  assert.match(adminHistory, /organizationId === "all"/)
  assert.match(adminHistory, /aria-label={`View processing details/)
  assert.match(recruiterHistory, /"cancelled", "deleted"/)
  assert.match(adminHistory, /"cancelled", "deleted"/)
  assert.match(timeline, /Artifact checkpoints/)
  assert.match(timeline, /job\.error\.at \|\| job\.failedAt/)
  assert.match(timeline, /Waiting for the job owner's ChatGPT/)
  assert.match(privateUpload, /seemplify:single-cv-upload:v1:/)
  assert.match(privateUpload, /may already be secured/)
  assert.match(privateUpload, /CV_IDEMPOTENCY_KEY_REUSED[\s\S]*localStorage\.removeItem\(processingStorageKey\)/)
  assert.match(privateUpload, /router\.push\('\/cv-processing'\)/)
  assert.match(recruiterHistory, /selected\.retry\?\.replacementAvailable/)
  assert.match(recruiterHistory, /selected\.retry\?\.canRunNow/)
  assert.match(recruiterHistory, /Run analysis now/)
  assert.match(recruiterHistory, /Previous errors remain here for audit/)
  assert.match(recruiterHistory, /seemplify:cv-replacement:v1:/)
  assert.match(recruiterHistory, /keyConflict[\s\S]*localStorage\.removeItem\(storageKey\)/)
  assert.match(adminHistory, /getAdminCVIngestionOrganizations/)
})

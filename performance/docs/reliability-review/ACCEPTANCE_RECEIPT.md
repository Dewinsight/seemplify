# Performance reliability and private storage: acceptance receipt

20 October 2026. This receipt separates source verification, disposable full-application testing, hosted checks, production deployment and actual storage-provider behavior.

## Changes delivered in this package

- Performance uploads use authenticated raw Cloudinary assets with preserved bytes/extensions, captured provider metadata and fresh five-minute downloads after document authorization.
- Appraisal detail, conversation context, report-generation inputs and content downloads apply the same document visibility rules. Hidden references survive later appraisal saves.
- Failed recognition colleague searches offer a retry and preserve the draft. Calibration sessions/cycle pickers distinguish failed loading from successful empty results and retain the session form.
- Browser CI builds and runs production UI behavior. The existing exact-count report assertions pass without relaxing their expectations.
- Attachment selection clears before the async upload, allowing the same file to be chosen again. Starting a retry removes the stale inline error; a successful retry retains the typed assessment explanation.

Organization-wide OKRs belong to authorized HR/admin/owner actors. Managers, team leads and department heads start staff appraisals within their granted scope. These existing role contracts were regression-tested; this package does not grant new account permissions.

## Verified source and test layers

Tested source head: `069a20b01f21741400484639f257dd043aea3ea0`. Released `main`: `da2e03c3c1c90c0297c7539abbc642d58a823264`. Both have the identical Git tree `833cf30e15ec1d318a09adaf0f1047fca37ea8a7`. Initial backend/API checks ran at `545803da`; the clean hosted run repeated them at the final source head.

| Layer | Result | What this establishes |
| --- | --- | --- |
| Backend `npm test` | 452 passed: 134 legacy + 38 unit + 280 Jest integration; 25 Jest suites | API contracts, private storage signing/cleanup and persistence/permission regressions |
| Full-application HTTP journeys | 709 requests; zero failures | Actual Express app, disposable MongoDB, production indexes and role-scoped action handoffs |
| Production-mode UI/fullstack browser regression | 151 first-attempt passes; zero flaky, failed or skipped cases | Real UI interactions, explicit API/provider substitutes where named, recovery, mobile, reloads and downloads |
| Clean report recovery replay | 5 passed with original assertions | Production UI performs the expected linked report reads; unrelated local assertion edit is excluded |
| Real-API browser release replay | 31 passed | Chrome, production-built UI and actual application API/persistence; external services remain named fixtures |
| Attachment retry repeats and cross-file isolation | 3/3 repeated cases and 8/8 lifecycle/storage cases, zero retries | Same-file upload recovery and a private-storage worker unaffected by earlier backend module caches |
| Managed Cloudinary preflight | TXT, PDF and DOCX passed | Actual authenticated uploads, exact-byte signed downloads, unsigned 401, expired-link denial and cleanup using existing centrally managed credentials |
| Deployed application storage adapter | All three formats passed at 06:42 UTC | Effective Performance Cloudinary selection; authenticated raw snapshots without stored signed URLs; exact-byte downloads 200; unsigned 401; expired links denied; assets removed |

Fixture roles: employee, teamless employee, team lead, manager, department head, HR manager, admin and owner. Anonymous and foreign-organization requests are negative cases. Synthetic workflows cover OKRs, reviews through employee acknowledgement, result/history exports, recognition, feedback, one-to-ones, development/support plans, succession, calibration and competency assessment.

The [role coverage matrix](ROLE_COVERAGE.md) records allowed, denied and expected-boundary requests across 22 API groups, generated from the 709-request proof.

The private-attachment browser case separately proves failed upload recovery, retained explanation, retry, persisted document/message links, denied outsider access before signing, authorized redirect and byte-identical browser download. Its Cloudinary transport and shared-AI calls are explicit test substitutes. Actual provider proof is reported separately.

Commands used:

```powershell
# performance/backend
npm test
node tests/helpers/liveJourneyServer.js
node tests/helpers/runLiveJourneys.js

# performance/frontend
$env:PERFORMANCE_E2E_PRODUCTION = '1'
npm run test:e2e
npm run test:e2e:live
```

The original embedded-report assertions were replayed from clean Git HEAD in an ignored temporary harness. The extra attachment case used its scoped fullstack harness. Test outputs and screenshots stay in ignored output folders or the private sibling access workspace; synthetic screenshots appear in the final PDF.

## Release and effective provider

- Pull request: [147](https://github.com/Dewinsight/seemplify/pull/147).
- Fresh malware scan at source head: passed, [39379559294](https://github.com/Dewinsight/seemplify/actions/runs/39379559294).
- Hosted Performance CI: [39379560998](https://github.com/Dewinsight/seemplify/actions/runs/39379560998), **passed**: backend, 709-request journeys, 151 UI/fullstack cases, 31 real-API browser cases and production build.
- Both deployed Performance images report `da2e03c3c1c90c0297c7539abbc642d58a823264`. Backend health, three public pages, 20 static assets, the current recovery bundle and OIDC redirect passed independent verification. Mock API URLs are absent from the inspected production scripts.
- Effective central provider: **Cloudinary**, policy revision **4**. The switch verified other solution defaults unchanged, no credential change and no existing-file migration.
- The scoped deployment ran all three canonical migrations, protected quarterly-review backups, shared-AI health verification, public/OIDC checks and revision checks. The deploy helper retained rollback images/compose and removed its temporary release archive. Synthetic Cloudinary assets were removed.
- The automatic [monorepo rollout](https://github.com/Dewinsight/seemplify/actions/runs/39381012731) was cancelled during QA, before deployment, to release the shared compute slot and avoid a redundant all-services rollout. The scoped Performance release used the same compute/deployment locks. This receipt does not claim an all-monorepo workflow pass. The automatic same-tree main Performance CI replay is separate from the completed PR acceptance.

Authenticated production browser smoke used the existing employee session: appraisal history loaded; Current and History tabs switched; OKR Past and Current tabs changed periods; recognition opened with the private audience default; a safe scoped search returned a genuine empty result; the form was cancelled without sending. No new 5xx appeared in the inspected console during this smoke. No real appraisal or recognition record was created. Actual-account records/screenshots remain outside the public repository and delivery PDF.

The operational switch changes only Performance's central provider default. Other application defaults and existing credentials remain unchanged. Existing Azure object snapshots retain their saved provider; no bulk migration is included. Competency private evidence uses its separate filesystem storage path.

### Failure disposition

The earlier hosted UI run at `545803da` recorded 150 first-attempt passes and one attachment case passing on retry. Its trace and the existing route-loading order exposed shared CommonJS backend state between fullstack test files. The storage test now has a distinct worker fixture; the lifecycle-plus-storage run passed all eight cases without retries. The investigation also closed stale upload error feedback and moved file-input clearing before the async callback. The three repeated attachment runs passed without retries. Superseded hosted runs were cancelled when new commits were pushed; they are not recorded as clean full-suite passes.

## Evidence limits

These checks do not certify every possible data combination or every production account. Local all-role acceptance uses synthetic IdP claims and a disposable database. Production navigation uses the existing signed-in account; it does not impersonate other employees or create real staff reviews/recognitions. New external calendar delivery, live relay/recording/transcription, a full production restore and a customer pilot are outside the proof recorded here.

The pre-existing local change to `performance/frontend/e2e/embedded-report-recovery.spec.ts` remains excluded from the release. No production credential was changed.

## Delivery documents

- [Delivery plan](DELIVERY_PLAN.md)
- [Product stories](PRODUCT_STORIES.md)
- [Architecture and QA contracts](ARCHITECTURE_QA.md)
- [Design review](DESIGN_REVIEW.md)
- [Role coverage matrix](ROLE_COVERAGE.md)
- Illustrated PDF: `output/pdf/Performance-reliability-and-private-storage.pdf`.

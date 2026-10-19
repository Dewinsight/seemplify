# Competency assessment execution ledger

Updated: 19 October 2026 (London). Baseline main: `b401f1b1`. Programme source is in PR135. Local acceptance now includes42 focused IdP checks,709 real HTTP requests and all29 production-mode real-API browser scenarios with the corrected default-role catalogue. Exact-head CI and security replay are required before merge; no application deployment yet.

| Workstream | Owner | State | Evidence / next handoff |
|---|---|---|---|
| Research and delivery plan | Coordinator | Complete | IMPLEMENTATION-PLAN.md; research/ primary sources |
| Product definition | PM-A / PM-B | Design approved | 25 stories CA-001–009 and CA-101–116; reviews/product-readiness.md |
| Domain/API/security contracts | SA-A + coordinator as SA-B | Design approved | architecture/; DEVELOPMENT-CONTRACT.md; three ADRs |
| Current screen audit and concepts | UX-A / UX-B | Complete | Private local baseline inventory, two written UX specifications and synthetic image-generated concepts |
| Team skills | Coordinator | Validated and installed | Five original SKILL.md files under team/skills and installed Seemplify competency role skills |
| Role, framework, strategy and cycle libraries | Developer pair A | Implemented; local QA passed | Library persistence included in independent competency run; nine UI cases plus one draft-backup case |
| Assessor/evidence/oral/scoring/report domain | Developer pair B | Implemented; local QA passed | Seven source-set API/PDF journeys, ten-person manual pilot; 96 competency persistence tests at final source-consent checkpoint |
| Appraisal setup, linked detail and final report | Coordinator + pair B UI | Implemented; local QA passed | Optional role selection, pending-link retry, full manager/goal/custom feedback; ten atomic parent race tests; UI/PDF provenance parity |
| IdP permissions and migration | Coordinator + SA reviewer | Implemented and tested | 35 IdP access/migration/directory tests pass; real disposable Mongo concurrent migration tested separately |
| Atomic finalisation and privacy review | Retained SA | Local review passed | reviews/implementation-qa.md; ten atomic parent tests, current source/privacy/AI authority/upload budget checks |
| Local authenticated acceptance | Coordinator | Manual path passed | Fresh local IdP sign-in; real localhost5005→5004 API; evidence/finding/feedback/oral submission/score80/finalisation/report; screenshots under evidence/screenshots |
| Real file scanner | Coordinator + pair A | Provider helper proof passed | Actual private ClamAV accepts/extracts synthetic TXT/PDF/DOCX and rejects safe AV test; evidence/actual-clamav-source-intake.json |
| Browser request integration | Coordinator | Fixed and verified | Real cross-origin If-Match preflight initially failed; allowed header fixed; OPTIONS204 and persisted UI save verified; evidence/local-cors-preflight.json |
| Personal ChatGPT / calendar/native source proof | Pair B + coordinator | Pending actual provider acceptance | Mocked provider contract tests do not establish live inference or recording consent; legacy unverified recordings fail closed |
| Release | Coordinator / SA | Final staged-source QA | Clean indexed frontend production build passed; clean indexed full backend regression193/193 passed; CI/merge/deployment/live remain open |
| Illustrated implementation PDF | Coordinator | Eight-page draft generated | All pages rendered and inspected; final proof labels/revision will be refreshed after release |

## Evidence boundaries

Browser contract fixtures prove interface states. Disposable Mongo tests prove domain/API persistence and denial behavior. The authenticated local walkthrough includes a fresh local IdP sign-in with synthetic local accounts and real API/database calls; it does not claim production acceptance. Scanner proof ran an isolated copy of the actual intake helper inside the existing backend container, not a deployed feature route.

Optional recording and AI settings default off. No production employee assessment, classification or decision has been created for this programme. An isolated private ClamAV container was provisioned; application images are unchanged.

## Integration safety

Unrelated appraisal lifecycle changes pre-existed this programme. Preserve all of them. The only programme changes to the shared appraisal router are the narrow final-outcome save helper and typed conflict response; stage those exact hunks rather than the unrelated lifecycle additions.

Automatic approval review rejected two credential-bearing local restart attempts with only a generic policy reason. The services were subsequently restored with public local configuration without extracting saved credentials; IdP4000, Performance API5004 and frontend5005 are available. This does not authorise bypassing a blocked credential action.

## Final local UX and source-consent acceptance

- Pair B: 31 distinct browser cases passed, including seven new actual rendered recording-consent component cases, source-withdrawal recovery and keyboard focus. Pair A: nine library cases plus one full draft-backup case. These 41 distinct cases use synthetic identities; the real-API journey uses actual Express/Mongo/scoring/PDF persistence.
- Final indexed frontend builds with webpack, including the last oral source-unavailable guard; all competency routes compile. External dependency junctions prevent Turbopack from running in the isolated snapshot, so no Turbopack source failure is claimed.
- Participant PDF: two A4 pages, strictly parsed, all pages visually inspected; human source versions, criterion definitions, actual submitted feedback, oral occurrence/time zone/participants/submitter/revision included.
- New recorded calendar meetings defer the Nylas notetaker until each actual participant separately agrees. Withdrawal fences provider sync and AI publication; current linked oral evidence is reauthorized. Legacy recordings are never retroactively certified. Calendar/gateway test providers are mocked; no real new recording was sent.
- Clean staged regression receipts: legacy83, unit38, gateway13 and IdP35 passed. The full118-case Mongo regression initially caught one outdated recording fixture; it now obtains both participants REST consent. Final clean-index rerun passed118/118 across nine suites.
- Earlier restart checkpoint: fresh local sign-in failed with incomplete local OIDC configuration. This was subsequently resolved by the fresh sign-in and linked setup receipt below; no saved credential extraction or authentication bypass was used.

## PR and final broader regression

PR: https://github.com/Dewinsight/seemplify/pull/135. Required security scan passed the superseded first head and privacy-corrected head. Broader Performance CI initially failed because its historical published-manager fixture omitted the submission timestamp. The fixture now includes actual submission provenance, and explicitly confirms drafts stay hidden even when their parent is completed. Source privacy guards were preserved.

A final cohort metadata review fixed incomplete-result signalling at the2,000-candidate scan cap without counting or naming inaccessible rows. The real Mongo cutoff/privacy regression passes. Final **clean-index full Performance integration run:193/193,18 suites,75.65s**. This supersedes the earlier118-case subset for complete backend regression evidence.

Experience CI has a proven unchanged baseline failure: current and prior main have527 tests,470 passed,46 failed,11 cancelled, with identical failure titles. Experience source tree75946657440ddebb6ad80f6cc066f3e77deb2ff7 and workflow blob0cdd668e765cdc79d6cb572e7aad366c65bcc286 are identical at prior main, PR base and first PR head. SDK Node20/22 checks pass. This programme does not claim all-repository CI is green. Evidence logs remain under `.local-runtime/competency-release-qa-20261019/`.

## Fresh local sign-in and linked setup resolved

The coordinator restored normal local OIDC client configuration using the application documented default, without extracting saved credentials or changing registered credentials. A fresh actual IdP session now signs in successfully. The actual existing Start appraisal wizard selected a synthetic Local Employee, Local Manager, published competency cycle and frozen role v1, and created exactly one ordinary appraisal plus one linked assessment. Participant/reviewer/role IDs match in actual replica-set Mongo. Local email delivery was directed to a disabled loopback endpoint. Receipt, link and published report screenshots plus `evidence/local-linked-wizard.json` record this proof. This supersedes the earlier fresh-local-login blocker.

## Published evidence privacy correction

Three actual-account baseline screenshots were initially pushed before repository visibility was checked. The repository is public. They were preserved in the ignored local evidence folder, removed from the feature branch tree and its rewritten programme history, and replaced by a private inventory in the design specifications. No actual-account image was sent to image generation. All remaining published images were visually checked and use synthetic people. A temporary exclusion for this exact feature branch allowed the corrective force-with-lease; the active no-force-push ruleset was immediately restored with an empty exclusion list. The new feature head is `9e589b74a4699997dca4833b3581c10156c69071`; application and workflow source trees match the fully tested preceding head. GitHub may retain cached old revisions; this correction does not certify server-side cache erasure.

## Full-browser regression checkpoint

The privacy-corrected PR CI passed backend/API journeys and105 of107 browser scenarios, including all competency scenarios. Two existing fullstack call cases failed: the calendar fixture still selected the previous consent wording, and native media conversion lacked an explicit FFmpeg dependency in CI. A genuine failed-run WebM contained valid VP8 video and Opus audio and converted successfully with the exact command locally. The release remains blocked while the fixture, both-participant calendar consent coverage, native dependency preflight and targeted call replay are completed. No recording or consent guard is being removed.

The corrected indexed call browser replay passed2/2 in46.7s without retries, using the clean frontend and backend snapshots on dedicated port5046. Calendar retry/history now includes each actual synthetic participant's separate UI acknowledgment and proves no bot dispatch before both agree. Native peers record and play genuine browser media, run real FFmpeg9.0.1 conversion, use mocked transcription/AI, and revisit history on mobile. Product source guards are unchanged. CI now explicitly installs FFmpeg before the full browser suite. Exact-head full CI replay is required before merge.

## Private evidence backup gate closed locally

The new private bind folder was absent from the existing backup inventory. The backup now captures a protected UUID-file archive and SHA256/size/mode manifest alongside paused-writer Mongo metadata. Actual Performance bind writers are resumed immediately after the pair, including failure paths; each phase has a300-second limit. An isolated restore rejects unsafe or corrupt members, verifies private permissions and matches currently usable Mongo references to retained bytes. Independent SA review replayed11 POSIX archive/adversarial/control-flow checks and5 real Mongo reference checks; all passed. These checks are wired into production CI. Existing14-day backup retention is unchanged. Recovery must reconcile withdrawals and deletion tombstones newer than a restored snapshot before user access; this is not a universal erasure or cross-store point-in-time claim. No full production backup or live restore was run for this test.

## Exact-head production-mode fixture correction

At bab7748, all107 browser scenarios passed in hosted CI, including both corrected call cases. The subsequent production-mode real-API suite passed23/29: six role-page checks received `PERMISSIONS_REFRESH_REQUIRED` from competency bootstrap. The synthetic identity server lacked the new explicit action grants and delegated directory authority. The production guard correctly refused that incomplete identity. Release remains blocked while the test identity fixture is updated to use the real IdP permission catalogue and directory builder, without changing production authorization. The193 clean API checks,43 distinct focused local browser cases and107 hosted browser cases are separate proof layers and are not added together.

The corrected fixture verifies real IdP role capabilities, self-only staff directories and explicit eligible reviewer selection, matching the current Start appraisal wizard. Legacy implicit manager inference is not certified; quarterly cycle seeding creates definitions and does not implicitly launch employee appraisals. Subsequent role tests exposed genuine overbroad default Performance grants in the IdP member catalogue. The release gate now includes narrowing built-in staff defaults, retaining scoped manager/department authority and full HR/admin/owner authority, then replaying all HTTP denial journeys. Published company-goal reads remain available for alignment. The schema migration must update canonical built-in Performance rows while preserving persisted non-Performance rows, separate custom roles, organisation overrides and member exceptions. Existing Performance sessions must be expired during a controlled backend stop after policy migration, so a pending request cannot restore old claims; normal SSO sign-in restores access without deleting business records or saved drafts. No current production permission migration or session expiry has been executed yet.

The schema5 correction passed40 focused/catalogue/directory checks plus two actual persisted Mongo migrations from schemas3 and4. Built-in Performance rows intentionally adopt the new defaults; persisted rows for other products, role metadata, separate custom roles and organisation/member exceptions remain unchanged. A second read does not repeat normalization or increment authorization revision again. Independent real HTTP replay now passes709 requests with zero failures, retaining the original denial assertions and six complete selected-reviewer appraisal lifecycles. Evidence: `evidence/default-role-migration.json`. Production policy migration and existing-session expiry remain unexecuted release gates. Rollback planning must account for the forward policy schema: do not blindly run an older IdP binary that could replace newer policy defaults.

Final local production-mode browser replay with the schema5 catalogue passed29/29 in1.7minutes, no retries. Bootstrap probes use the actual browser credentialed CORS transport, and retain status, per-role capability and self/cross-organisation isolation checks. The earlier Playwright API-client socket reset is not counted as a product pass. The complete107-scenario hosted browser suite passed at the preceding product source; the current fixture/catalogue/migration revision requires its own full hosted replay before release.

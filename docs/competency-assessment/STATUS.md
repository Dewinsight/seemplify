# Competency assessment execution ledger

Updated: 19 October 2026 (London). Baseline main: `b401f1b1`. Programme commit419fbf98 is pushed in PR135. Final review fixes are being pushed for CI replay; no application deployment yet.

| Workstream | Owner | State | Evidence / next handoff |
|---|---|---|---|
| Research and delivery plan | Coordinator | Complete | IMPLEMENTATION-PLAN.md; research/ primary sources |
| Product definition | PM-A / PM-B | Design approved | 25 stories CA-001–009 and CA-101–116; reviews/product-readiness.md |
| Domain/API/security contracts | SA-A + coordinator as SA-B | Design approved | architecture/; DEVELOPMENT-CONTRACT.md; three ADRs |
| Current screen audit and concepts | UX-A / UX-B | Complete | design/baseline, two written UX specifications and synthetic image-generated concepts |
| Team skills | Coordinator | Validated and installed | Five original SKILL.md files under team/skills and installed Seemplify competency role skills |
| Role, framework, strategy and cycle libraries | Developer pair A | Implemented; local QA passed | Library persistence included in independent competency run; nine UI cases plus one draft-backup case |
| Assessor/evidence/oral/scoring/report domain | Developer pair B | Implemented; local QA passed | Seven source-set API/PDF journeys, ten-person manual pilot; 96 competency persistence tests at final source-consent checkpoint |
| Appraisal setup, linked detail and final report | Coordinator + pair B UI | Implemented; local QA passed | Optional role selection, pending-link retry, full manager/goal/custom feedback; ten atomic parent race tests; UI/PDF provenance parity |
| IdP permissions and migration | Coordinator + SA reviewer | Implemented and tested | 35 IdP access/migration/directory tests pass; real disposable Mongo concurrent migration tested separately |
| Atomic finalisation and privacy review | Retained SA | Local review passed | reviews/implementation-qa.md; ten atomic parent tests, current source/privacy/AI authority/upload budget checks |
| Local authenticated acceptance | Coordinator | Manual path passed | Existing local IdP session; real localhost5005→5004 API; evidence/finding/feedback/oral submission/score80/finalisation/report; screenshots under evidence/screenshots |
| Real file scanner | Coordinator + pair A | Provider helper proof passed | Actual private ClamAV accepts/extracts synthetic TXT/PDF/DOCX and rejects safe AV test; evidence/actual-clamav-source-intake.json |
| Browser request integration | Coordinator | Fixed and verified | Real cross-origin If-Match preflight initially failed; allowed header fixed; OPTIONS204 and persisted UI save verified; evidence/local-cors-preflight.json |
| Personal ChatGPT / calendar/native source proof | Pair B + coordinator | Pending actual provider acceptance | Mocked provider contract tests do not establish live inference or recording consent; legacy unverified recordings fail closed |
| Release | Coordinator / SA | Final staged-source QA | Clean indexed frontend production build passed; clean indexed backend regression118/118 passed; CI/merge/deployment/live remain open |
| Illustrated implementation PDF | Coordinator | Eight-page draft generated | All pages rendered and inspected; final proof labels/revision will be refreshed after release |

## Evidence boundaries

Browser contract fixtures prove interface states. Disposable Mongo tests prove domain/API persistence and denial behavior. The authenticated local walkthrough uses an existing real local IdP session with synthetic local accounts and real API/database calls; it does not claim a fresh sign-in or production acceptance. Scanner proof ran an isolated copy of the actual intake helper inside the existing backend container, not a deployed feature route.

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
- Fresh local sign-in currently fails after the public-configuration API restart because its original OIDC client secret is not loaded. Earlier authenticated local manual acceptance passed; this is explicitly not a fresh sign-in proof. No credential extraction or authentication bypass is used.

## PR and final broader regression

PR: https://github.com/Dewinsight/seemplify/pull/135. Required security scan passed first head419fbf98. Broader Performance CI initially failed because its historical published-manager fixture omitted the submission timestamp. The fixture now includes actual submission provenance, and explicitly confirms drafts stay hidden even when their parent is completed. Source privacy guards were preserved.

A final cohort metadata review fixed incomplete-result signalling at the2,000-candidate scan cap without counting or naming inaccessible rows. The real Mongo cutoff/privacy regression passes. Final **clean-index full Performance integration run:193/193,18 suites,75.65s**. This supersedes the earlier118-case subset for complete backend regression evidence.

Experience CI has a proven unchanged baseline failure: current and prior main have527 tests,470 passed,46 failed,11 cancelled, with identical failure titles. Experience source tree75946657440ddebb6ad80f6cc066f3e77deb2ff7 and workflow blob0cdd668e765cdc79d6cb572e7aad366c65bcc286 are identical at prior main, PR base and first PR head. SDK Node20/22 checks pass. This programme does not claim all-repository CI is green. Evidence logs remain under `.local-runtime/competency-release-qa-20261019/`.

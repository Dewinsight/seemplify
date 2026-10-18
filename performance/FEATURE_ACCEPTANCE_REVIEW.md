# Performance feature acceptance review — 17 October 2026

This review follows the reported OKR creation failure, recognition failure, and difficult appraisal navigation. A passing local test is distinct from a production deployment or an external service acceptance result.

## Repairs

- Recognition used the complete colleague search result (`id`) where submission required `recipient.userId`. The frontend now submits the canonical ID and the backend also accepts the actual picker shape for cached clients. Recipient team details come from the same-organization membership mirror. Teamless recipients default to private visibility, and validation errors appear inside the open form.
- Succession nominations had the same picker mismatch. Normalize at the search boundary and show errors inside the active dialog.
- Department heads could see manager features but could not launch appraisals for the departments granted in their IdP claims. Resolve those teams within the active organization, without extending authority to other departments or tenants.
- Calibration lacked rating decision controls and its export only logged to the console. HR can now approve or adjust a rating, supply the reason, complete the session, and download CSV. Backend guards prevent empty sessions, finalized-result reuse, invalid ratings, deferred completion, generic state/tenant mutation, and reopening completed results.
- After creating a goal in another period, select its period and workspace so the saved goal is visible. After creating a direct report's development plan, select Team plans.
- Verify the signed shared AI authority during production deployment, in addition to container health.

The compound OKR idempotency index repair was separately merged and deployed in PR #111. It is already on the base revision for this review.

## Repeatable verification

The full-application fixture binds only to `127.0.0.1:5014`, uses disposable MongoDB with production model indexes, and creates synthetic sessions and IdP claims. Production `app.js` never imports the fixture or exposes its login bridge. External identity, AI, presence, notification delivery, and calendar services are not used by the fixture.

| Layer | Result / scope |
| --- | --- |
| Backend `npm test` | 181 passing: 78 legacy, 38 unit, 65 MongoDB integration tests in eight suites |
| Full application HTTP journeys | 695 requests, zero failed assertions; real routes, sessions, RBAC, persistence, indexes, and tenant boundaries |
| Real API browser suite | Chrome exercises real frontend and the disposable full backend; no product API interception |
| Existing browser suite | Retained UI regression coverage, including mobile appraisal initiation and adverse states; API responses are mocked in this separate suite |
| Production read-only API smoke | 32 successful reads using an existing HR session; this is not an eight-role production test |
| Production PR #111 release | Exact backend/frontend revision `4a78f6eca410b186fca7c255a8a8b9059c979096`, public health/assets, OIDC start and signed-in browser verified |

Roles exercised through HTTP and browser journeys: employee, team lead, line manager, department head, HR manager, organization admin, owner, and employee with no assigned team. Anonymous access and a foreign organization are also tested as negative cases. These are synthetic role claims; production identities continue to originate in Seemplify Identity.

| Feature | Verified behavior |
| --- | --- |
| Navigation and role access | Available employee, manager and HR pages; 47 API read/permission checks per role; denied manager/HR endpoints for employees |
| OKRs and periods | Individual creation for all roles, HR-only organization creation, repeated organization saves, approval/acknowledgement, versioning, progress/score contracts, immutable snapshots, alignment tabs, tenant isolation, CSV download |
| Appraisal launch | Manager/team lead/department head/HR/admin/owner launch; scoped staff, deadline validation, partial outcomes, replay safety, frozen cycle questions and a 1,000-person integration fixture |
| Appraisal participation | Manual self-assessment and typed custom responses, manager review, discussion, calibration, finalization, published employee report and acknowledgement; guided conversation contracts use an isolated AI substitute |
| History and reporting | Completed-result search, published report, CSV, year/sort controls and access redaction; internal audit data excluded from employee report |
| Feedback | Real colleague picker and send, received persistence, project membership checks, anonymous 360 minimum-response privacy threshold |
| Recognition | Search, send, reload, sent/received views, acknowledgement, withdrawal, teamless visibility, same-organization recipient enforcement |
| Check-ins | Create, edit, submit, linked goal and immutable submitted state |
| One-to-ones | Scoped scheduling, employee agenda, follow-up action completion, manager completion, employee feedback, private-note redaction and tenant boundary; external calendar delivery not claimed |
| Development and Learning | Manager creates/activates/completes a staff plan, employee check-in and skill/activity progress, optional fields, participant access, synchronized Learning record contracts and UI linking |
| Support plans | Manager proposal, HR review/change request/approval, employee acknowledgement, progress check-ins and restricted visibility |
| Talent and succession | Frozen performance evidence, scoped manager proposals, HR calibration, candidate nomination, tenant boundaries, 1,000-person integration fixture; AI cannot choose a talent decision |
| Analytics and coaching | Finalized-performance ranking and drilldown, scoped practice signals, employee denial for manager coaching |
| Actions and notifications | Read/count endpoints, durable outbox idempotency, chat-delivery worker contracts, completed reminder closure, leave pause/resume; no synthetic messages sent to real staff |

## External service findings and limits

- Shared AI account settings initially failed because the shared Redis container had stopped after a Docker networking error, causing Recruiter startup to fail. Starting that existing Redis container recovered Redis and Recruiter. Performance's signed health probe then succeeded and authenticated AI settings recovered. No storage volumes or credentials were changed.
- Actual Azure attachment upload remains **blocked**. A synthetic 52-byte upload using the production Performance storage service returns Azure `404 ResourceNotFound`. Account information and container properties can be read, but both SDK and older-version REST write probes fail. No test attachment was created. Azure CLI has no signed-in account on this computer; Azure resource access is needed to diagnose the account. Do not classify attachments as passing or silently switch the centrally selected storage provider.
- Live ChatGPT content generation was not submitted: the current account still requires the Performance-specific sharing acknowledgement. Connection, model/limit settings and consent guards are verified; this does not prove generation with live HR content.
- Synthetic positive writes run in the disposable environment. Existing production staff appraisals and recognition were not modified by this audit. Provider mail/calendar delivery and every possible feature/role/data combination are not established by this suite.

## Commands

```sh
cd performance/backend
npm test
node tests/helpers/liveJourneyServer.js
# In another terminal, while the disposable server is running:
node tests/helpers/runLiveJourneys.js

cd performance/frontend
npm run test:e2e
npm run test:e2e:live
npx tsc --noEmit
npm run build
```

Do not run two Next development servers concurrently from this frontend checkout. The browser configs manage their own servers when one is not already running. The full-application HTTP proof is written under ignored `performance/backend/tmp/`; browser traces and screenshots contain synthetic fixture data. Dedicated Performance CI runs the backend, API journeys, both browser suites and production build, with fixture cleanup on failure.

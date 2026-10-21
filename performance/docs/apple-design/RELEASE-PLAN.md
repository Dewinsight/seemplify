# Performance Management Apple redesign: release runbook

Owner: retained Solution Architect / QA / release operator. Date: 21 October 2026. State: exact tested source `8ce5e4b4` deployed successfully in run `39524124932`; independent revision, health/OIDC and three-role live acceptance passed.

## 1. Authorized scope and release invariant

The user authorized implementation, QA, architect-owned commit/push/live release and administrator bypass if required. This authorization does not remove the QA gate or justify releasing unrelated dirty work. Work remains on canonical `main`; production must run the exact tested `main` commit. The legacy `master` ref may only fast-forward to `main`, never become a development/deployment source.

No production credentials change is required for this design programme. Existing root-only service secrets remain referenced by name. If authentication is needed for acceptance, use authorized existing access and keep credentials out of chat, repository, logs and screenshots.

## 2. Preflight

1. Re-resolve checkout to `E:/GitHub/C-drive/seemplify`; record `git status`, current branch and full HEAD. Fetch all refs. Identify relevant recent task branches, compare with `main`, and incorporate relevant approved work before pushing; do not merge arbitrary branches based on recency alone.
2. Review exact programme diff and all untracked paths. Exclude initial unrelated calendar/notetaker changes and existing reliability-review documents. If a programme fix touches a dirty path, stage only the verified programme hunks with an explicit review, preserving previous edits.
3. Confirm both developer lanes are finished. Collect product acceptance, architecture review, QA results, build output and screenshot manifest. No release on incomplete QA.
4. Inspect current remote branch/rules and deployment workflow. Record current protection settings before using the user's authorized administrator bypass; prefer an available admin merge/push path that does not alter protections. If temporary settings change is unavoidable, restore and verify immediately after the authorized mutation.
5. Check current deployment queue and runner health; do not cancel another production release without cause. Validate any modified workflow with the available workflow validator; this programme does not silently repair unrelated CI infrastructure.

## 3. Commit and CI

Stage an explicit allow-list of approved programme paths only. Never `git add .` or stage the whole `performance` tree. Record `git diff --cached --stat`, review patch, commit SHA and remaining working-tree changes. Push canonical `main` without force. If the remote advanced, reconcile safely and rerun checks affected by the resulting source before release.

Track Performance CI and deployment runs for that SHA. A successful push or merged PR is source publication only; CI and deployment are separate receipts. Preserve test artifacts and failed-run diagnostics.

## 4. Deployment constraints found in current source

`.github/workflows/deploy-core-hostinger.yml` triggers on `performance/frontend/**` pushes to `main`. Its existing immutable core release builds and deploys multiple Seemplify applications, not only Performance. The source-change scope remains Performance-only, but the operational blast radius of using this existing workflow is the core suite. Do not claim an isolated Performance-only deployment if that workflow is used. Check for a supported narrower deployment path before choosing an approach; do not invent one during a visual change.

The workflow labels Performance images `org.opencontainers.image.revision=$RELEASE_SHA`, deploys under a host lock and verifies container revision labels. Production Performance URLs in source are `https://performance.seemplifyai.com` and `https://api-performance.seemplifyai.com`. Treat older Dokploy deployment notes as historical; current workflow/host state wins.

## 5. Live proof

Record timestamp, run URL and tested full SHA. Require:

1. Deployment job completes for the expected SHA; Performance frontend and backend container revision labels match the intended release. Verify running images, not only an image that was built.
2. Public frontend and `/health` API respond; no missing CSS/font/chunk resources.
3. Performance OIDC start redirects to `https://auth.seemplifyai.com`; identity remains the production authority. Check callback/return path without logging token fragments.
4. An authorized authenticated browser opens employee/manager/HR workspaces as available; inspect dashboard, goals, appraisals/report, a continuous-performance surface and competency pages in both themes, with mobile navigation. Confirm important actions/forms/recovery remain usable. Avoid destructive production writes; use an approved synthetic record if a write is necessary.
5. If the core workflow deployed other applications, run its existing suite smoke and report those results separately from Performance UX acceptance.
6. Record any provider-dependent feature that could not be verified. No inference from disposable API or old provider reports.

### Read-only preflight observed during design (not the programme release)

Remote `main` was `39c3f4ff56851609921a19e5bb1e0d226893bd59`. Its existing core deployment [run 39515983494](https://github.com/Dewinsight/seemplify/actions/runs/39515983494) was in progress. Both running Performance containers still carried prior healthy revision `49279d6ded068137b526531b36078d19aff68ada`; frontend returned HTTP 200 and API health returned `status: ok`. This baseline must be refreshed after the programme push; it is not evidence of the redesign being deployed.

The active GitHub actor has administrator permission. Main is protected by both a PR-only ruleset (organization-admin bypass restricted to pull-request mode) and classic one-approval protection with administrator enforcement disabled. Prefer preserving protection settings. The repository also requires development on checked-out `main` unless the user explicitly requests a branch/PR, so do not create a task branch merely to avoid those rules. If direct push is the chosen authorized publication path and blocked, use only the user's narrow temporary administrator exception, snapshot exact settings first, restore/verify immediately, and never force-push. No protection setting has been changed during preflight.

## 6. Rollback

Before release, capture previous running Performance image references/revision and the previous healthy immutable release. For CSS/UI regression, revert only programme commits on `main` and deploy the resulting tested commit, or use the established immutable rollback procedure if immediate recovery requires it. Do not reset the user's working tree, force-push, delete data/volumes or roll back unrelated app data. Restore protections after any bypass and confirm final state.

## 7. Completion receipt and PDF

The receipt lists source SHA, exact changed paths/story IDs, QA commands/results, CI/deploy URLs, running revision, OIDC result, authenticated browser scope, rollback revision and remaining limitations. The PDF uses numbered changes, a concise explanation, actual before/after screenshots, concept labels where relevant and verification captions. It must not call a concept an implemented screen, a local pass a production pass, or planned work complete.

## Execution checkpoint

- Source commit: `81212b2ae4528847d41f682af00bdb2e7810c491`; exact tested tree `d9428462c2efea48cb52c55e4413636d7a7f4935`, 38 explicit source/test paths, parent `a93ddbf9`. Retained product acceptance covers AD-01..AD-12.
- Main push completed without force after a narrow authorized organization-admin exception. Original ruleset restored and verified immediately; classic protection unchanged. See `evidence/protection-release-receipt.json`.
- [Exact-source deployment](https://github.com/Dewinsight/seemplify/actions/runs/39519982007) is queued behind the existing prior release; no prior run was cancelled.
- Fresh all-ref fetch verified 31 relevant recent branches have zero commits ahead of main (`evidence/branch-preflight.json`). Unrelated documentation remains excluded from staging.
- Existing, unexpired authorized QA actors for employee, manager and HR complete ordinary central-Identity OIDC and return verified production `/api/auth/me` HTTP 200. Private sessions remain only in sibling access; authenticated redesign browser acceptance waits until the running revision matches this source commit. No accounts, passwords, app grants or production data were changed.


## Final combined publication checkpoint

Source `8ce5e4b447d2b070870bdf75154b46abde6b18a7` is published on canonical main, with exact tested tree `7eb9c096330d19b1a854c0f45fa15d0583f09c13`, preserving parent d1 analytics. All twelve product/visual story gates cleared. Both production builds passed; combined UI 25/25 and preserved backend integration 9/9 passed. Real API recorded 19 initial passes plus one HR selection failure, followed by three unchanged passing replays of that case; cause is unproven.

Final run [39524124932](https://github.com/Dewinsight/seemplify/actions/runs/39524124932) is active after the prior healthy d1 release completed. Its exact running revisions and health are captured in the rollback receipt. Source and tests stay frozen while final deployment, public/OIDC and authenticated role acceptance complete. Protection settings have already been restored and verified after publication.

## Completed production receipt

Final source `8ce5e4b447d2b070870bdf75154b46abde6b18a7` is deployed and independently verified on frontend/backend. Whole-core run `39524124932` succeeded. Public frontend/API health passed; ordinary OIDC redirected to central Identity. All three existing employee/manager/HR actors authenticated with subject/organization verified and completed 19 read-only browser captures: zero failed reads, runtime errors or document overflow. Final competency navigation, actual role-specific workspace headings and dark-mobile menu Escape were observed. A supplemental native 1440×1000 dark-manager viewport is available for the PDF.

Immediately prior healthy d1 images remain available; the uploaded release archive was cleaned. Protection restoration receipts remain unchanged. See `evidence/live/release-verification.json`, `identity-acceptance.json`, `authenticated-smoke.json` and `native-viewport-smoke.json`.

The final PDF/gallery publish in a separate documentation-only commit and identify deployed source 8ce independently of documentation HEAD. Provider execution, production form writes and exhaustive production data states remain outside this read-only acceptance boundary.

# Journey SDK publish checklist

This checklist exists so the first npm release is driven by current evidence,
not memory. It does not broaden the release criteria in
`SDK-RELEASE.md`; it makes the remaining external and workflow steps explicit.

For the current overall snapshot, prefer
`npm run report:sdk:publication-readiness`. Use the narrower landing, delta, and
publish-preflight commands when you need to inspect one part of that snapshot
in more detail.

## Current state on Thursday, August 6, 2026

- The five npm SDK packages are release-shaped:
  - `private: false`
  - `license: MIT`
  - per-package `LICENSE` files present
- Local gates pass:
  - `npm run qualify:sdk`
  - `npm run verify:sdk:release`
  - `node scripts/sdk-package-tools.mjs release-ready`
  - `npm run test:journey-swift:contract`
  - `npm run test:journey-kotlin:contract`
- The protected GitHub environment `npm-production` exists.
- The protected GitHub environment `npm-production` currently reports required
  reviewers.
- The repository currently has both `main` and `master` branches, but the SDK
  publish path is intentionally wired to `main`.
- The publish workflow still remains disabled at
  `../.github/workflows/publish-journey-sdks.yml.disabled`.

## Repo and workflow steps

These steps are inside repository control and should be completed before the
first authorised publish run.

1. Merge the intended SDK publish changes onto `main`.
   - Evidence:
     - `git branch --show-current` returns `main`
      - the intended files are committed on `main`
      - `npm run report:sdk:publication-readiness` records the current repo-side
        landing status and required-file delta in one reproducible artifact
      - `npm run preflight:sdk:landing` reports that `main` contains the
       required SDK publish-state files
      - `npm run evidence:sdk:delta` shows no remaining `main...HEAD` delta for
        the required SDK publish-state files
   - Current gap on Thursday, August 6, 2026:
     - `main` does not yet contain the current branch's SDK publish-policy and
       evidence files, including `packages/SDK-QUALIFICATION.json`,
       `packages/SDK-RELEASE.md`, `packages/SDK-PUBLISH-CHECKLIST.md`, and
       `scripts/sdk-publish-preflight.mjs`
2. Keep the publish workflow disabled until npm-side setup is complete.
   - Evidence:
     - `npm run report:sdk:publication-readiness` shows repo/workflow and
       external blocker sections consistent with the lower-level checks
     - `npm run preflight:sdk:publish` reports no external setup blockers other
       than workflow disablement
3. When npm-side setup is complete, activate the workflow and update the
   qualification policy in the same commit.
   - Evidence:
     - `../.github/workflows/publish-journey-sdks.yml.disabled` has been
       renamed to its final active filename
     - `packages/SDK-QUALIFICATION.json` now records that final workflow path
       and no longer requires the disabled suffix
     - `npm run qualify:sdk`
     - `npm run preflight:sdk:publish`
     - `gh api repos/Dewinsight/seemplify/environments/npm-production`
4. Commit the publish-preflight support files together with the scripts and
   docs that reference them.
   - Evidence:
      - `scripts/sdk-publish-preflight.mjs` is tracked
      - `scripts/sdk-landing-preflight.mjs` is tracked
      - `scripts/sdk-publish-delta.mjs` is tracked
      - `packages/SDK-PUBLISH-CHECKLIST.md` is tracked
      - `package.json`, `packages/SDK-RELEASE.md`, and
        `packages/SDK-QUALIFICATION.json` reference files that exist

## External npm account setup

These steps require npm-side authority and cannot be completed from repository
state alone.

1. Sign in to the intended npm release-owner account.
   - Evidence:
     - `npm whoami` succeeds
2. Enable account 2FA for that npm account.
   - Evidence:
     - npm account settings confirm 2FA is enabled
3. Create or verify the `@seemplify` npm organisation.
   - Evidence:
     - `npm org ls seemplify` succeeds, or
     - npm web UI shows the organisation and owner membership
4. Confirm that the release owner has write or owner authority for the
   `@seemplify` package namespace.
   - Evidence:
     - npm web UI or CLI package/org ownership view
5. Configure trusted publishing for the exact GitHub repository, workflow, and
   protected `npm-production` environment recorded in this repository.
   - Evidence:
     - npm web UI trusted-publisher settings, or
     - `npm trust` output from a compatible npm CLI
   - Important:
     - bind npm to the final active workflow filename, not the temporary
       `.disabled` filename
6. Prefer npm's strongest publishing access setting that remains compatible with
   the chosen release method.
   - Evidence:
     - package publishing-access settings recorded in npm

## Tooling notes

- The protected GitHub publish workflow now pins Node `22.14.0` and installs
  npm `11.5.1` before the publish step.
- This workstation may still be below that local management baseline. That does
  not by itself block a GitHub Actions publish if the workflow remains pinned
  correctly.
- npm's current `npm trust` command has a newer CLI floor than this machine may
  satisfy. If `npm trust` is unavailable, use the npm web UI for trusted
  publisher setup.

## Final publish evidence

The first publish is not complete until all of the following are true:

0. `npm run report:sdk:publication-readiness` shows a green repo-side landing
   status and no remaining required-file delta against `main`.
1. `npm run preflight:sdk:publish` reports no repository/workflow or external
   setup blockers.
2. The publish workflow is active on `main`.
3. The GitHub Actions publish run succeeds in `npm-production`.
4. `npm view @seemplify/journey-event-protocol@next version` returns the
   released version instead of `404`.
5. The complete coordinated package set exists on npm under the `next` dist-tag.
6. The approved coordinated release version is recorded explicitly for the run
   (for example `0.1.0`) and matches every published package manifest.

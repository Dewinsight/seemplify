# SDK publication readiness report

Generated at: 2026-08-06T18:07:55.429Z

## Summary

- Date: Thursday, August 6, 2026
- Current branch: codex/deep-graph-analysis
- Target branch: main
- Repo-side landing preflight: failed
- Required files missing on main: 4
- Committed main...HEAD SDK publish-state diffs: 4
- Working-tree SDK publish-state entries: 0
- Publish preflight: failed

## Repo-side landing status

- packages/SDK-QUALIFICATION.json: missing on main
- packages/SDK-RELEASE.md: missing on main
- packages/SDK-PUBLISH-CHECKLIST.md: missing on main
- scripts/sdk-publish-preflight.mjs: missing on main

## Required SDK publish-state delta

- packages/SDK-QUALIFICATION.json: A	experience-management/packages/SDK-QUALIFICATION.json
- packages/SDK-RELEASE.md: A	experience-management/packages/SDK-RELEASE.md
- packages/SDK-PUBLISH-CHECKLIST.md: A	experience-management/packages/SDK-PUBLISH-CHECKLIST.md
- scripts/sdk-publish-preflight.mjs: A	experience-management/scripts/sdk-publish-preflight.mjs

## Publish preflight repository/workflow blockers

- publish workflow is still disabled: .github/workflows/publish-journey-sdks.yml.disabled
- current branch is codex/deep-graph-analysis; the publish workflow requires main

## Publish preflight external setup blockers

- npm authentication is unavailable on this machine: npm error code ENEEDAUTH npm error need auth This command requires you to be logged in. npm error need auth You need to authorize this machine using `npm adduser` npm error A complete log of this run can be found in: C:\Users\User\AppData\Local\npm-cache\_logs\2026-08-06T18_08_11_214Z-debug-0.log
- npm scope @seemplify is not proven ready: npm error code E404 npm error 404 Not Found - GET https://registry.npmjs.org/-/org/seemplify/user - Scope not found npm error A complete log of this run can be found in: C:\Users\User\AppData\Local\npm-cache\_logs\2026-08-06T18_08_11_880Z-debug-0.log

## Publish preflight workstation limitations

- local Node v22.11.0 is below the trusted-publishing floor 22.14.0
- local npm 11.0.0 is below the trusted-publishing floor 11.5.1

## Not claimed

- This report does not prove npm authentication, npm organisation ownership, or trusted-publisher configuration are complete.
- This report does not prove the broader connected-journey release gates are complete.
- This report does not prove the SDKs are publishable today.

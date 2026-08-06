# Journey SDK release and deprecation process

## Safety state

External publication is disabled:

- the five npm SDK manifests are release-shaped (`private: false`, MIT, per-package `LICENSE`) but still unpublished;
- the trusted-publishing workflow is checked in with a `.disabled` suffix;
- the publication gate refuses private packages, refuses packages without an
  explicit licence decision and requires an exact confirmation value;
- ordinary pushes and pull requests cannot invoke a registry write.
- the Kotlin foundation retains a `-foundation` version and disables every
  Gradle Maven publication task; and
- the Swift foundation has no remote dependency, release tag, binary target,
  archive/distribution step or package-registry workflow.

Do not remove these controls until the Connected Journey master-plan release
gates are complete and an authorised owner approves the release.

## Current repo-side landing prerequisite

Before the first authorised publish attempt, the intended SDK release state
itself must exist on `main`, not only on a working branch. As of Thursday,
August 6, 2026, `main` does not yet contain the current branch's SDK
publish-policy and evidence files, including
`packages/SDK-QUALIFICATION.json`, `packages/SDK-RELEASE.md`,
`packages/SDK-PUBLISH-CHECKLIST.md`, and `scripts/sdk-publish-preflight.mjs`.

Do not treat workflow activation alone as sufficient. The publish-policy,
qualification, checklist, and preflight state must first land on `main`, and
only then should npm-side setup and final workflow activation be considered.

The executable repo-side proof for this prerequisite is:

```sh
npm run report:sdk:publication-readiness
npm run preflight:sdk:landing
npm run evidence:sdk:delta
```

These commands remain intentionally non-publishing. The consolidated readiness
report is the preferred current snapshot: it records the current repo-side
landing status, required-file delta, publish-preflight blockers, and
workstation limitations in one reproducible artifact. The landing and delta
companions remain useful as narrower debugging checks on that same required
file set.

## Decisions required before the first release

1. Create or verify ownership of the npm `@seemplify` organisation.
2. Decide whether the first public version is an alpha under `next`, a public
   beta, or a stable `1.0.0`. The current `0.1.0` npm packages are prepared
   for release but must not be promoted to `latest` accidentally.
3. Ratify the support matrix, protocol compatibility policy, support ownership,
   vulnerability intake and time-based deprecation window.
4. Bind npm Trusted Publishing to the exact repository, workflow filename and
   protected `npm-production` environment.
5. Separately decide the Swift distribution/tag strategy and the Kotlin Maven
   repository, coordinates, signing, provenance and protected environment. npm
   approval does not authorise either native distribution.

If the owner-approved SPDX decision ever changes, the repository-local helper
can re-apply that choice across the five npm SDK packages and the qualification
policy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\apply-sdk-license.ps1 -LicenseId MIT -CopyrightHolder "Seemplify"
```

`-MakePublic` has already been used for the five npm SDK packages in this
repository state; rerun it only if a future owner-approved licence change
should also keep the packages non-private.

## Versioning and order

The initial packages are released as a coordinated set. Exact internal
dependencies make the order mandatory:

1. `@seemplify/journey-event-protocol`
2. `@seemplify/journey-browser-sdk`
3. `@seemplify/journey-node`
4. `@seemplify/journey-react-native`
5. `@seemplify/journey-react`

Browser, Node and React Native may follow Protocol independently; React must
follow Browser.
npm publication is not transactional. If a published artifact is defective,
publish a corrected version and update every exact dependent version. Never
reuse or overwrite a published version.

The native foundations are not part of that npm transaction. SwiftPM
`SeemplifyJourney` and Maven `com.seemplify:journey-kotlin` must each declare the
exact wire versions they support and pass their own Apple/Android release gates
before an independently approved first tag or artifact. Neither may reuse the
npm confirmation path as distribution authority.

## Required clean verification

From `experience-management`:

```sh
npm run report:sdk:publication-readiness
npm run preflight:sdk:publish
npm ci
npm run clean:sdk
npm run typecheck:sdk
npm run test:sdk
npm run build:sdk
npm run verify:sdk:release
npm run test:journey-swift:contract
npm run test:journey-kotlin:contract
```

`verify:sdk:release` performs two clean builds and compares hashes, runs every
manifest's `prepack` artifact guard, runs browser- and React-Native-resolvable
restricted-host compatibility checks in both ESM and CommonJS, validates dry-run
tarball contents and installs real tarballs offline into isolated ESM,
CommonJS, mixed-format and TypeScript declaration consumers.

`preflight:sdk:publish` is intentionally non-publishing. It reports the current
workstation and repository blockers for an authorised publish attempt, including
workflow enablement, branch, local Node/npm trusted-publishing floors, GitHub
CLI auth, npm auth, npm scope readiness, and whether the first package is
already published.

The CommonJS pass is deliberately stricter than "the export is callable". It
asserts that `require.resolve` returns a path under `dist/cjs/` and that the
required value is not an ES module namespace object, because Node `>=20.19` can
`require()` an ES module without throwing. The mixed-format pass loads the ESM
and CommonJS builds of `@seemplify/journey-node` in one graph and proves the
verified-identity registry is shared across the two module instances while an
unmarked object is still rejected by both.

Coverage limit to keep in mind when reading a green run: the equivalent
`@seemplify/journey-react` lease registry is internal and not reachable through
the export map, so the mixed-format pass asserts only that its two builds are
distinct module instances, not that they share lease state.

Both compatibility scripts resolve the package by specifier from the package's
own directory, using package self-reference. They deliberately do not resolve
from the workspace root, because that would depend on a hoisted
`node_modules/@seemplify/*` install link and would turn the gate red or green on
install topology rather than on the export map.

Before an authorised publish, the disabled workflow additionally runs:

```sh
SDK_PUBLISH_CONFIRM=PUBLISH_JOURNEY_SDKS \
SDK_RELEASE_VERSION=<approved-version> \
node scripts/sdk-package-tools.mjs release-ready
```

That command is expected to stay non-publishing: it validates coordinated
versioning, approved licence metadata, per-package `LICENSE` files, deterministic
artifacts and tarball shape, then stops. `release-ready` checks
`SDK_PUBLISH_CONFIRM` before anything else, so running it without that variable — the safest way to confirm
the gate is wired — fails immediately at the confirmation check and never
reaches the manifest or pack stages. The command contains no `npm publish` and
never contacts a registry under any environment combination; it is a read-only
gate that ends in a dry-run pack.

The Swift static contract is not compilation evidence. On the pinned approved
macOS/Xcode host, also require:

```sh
swift package dump-package --package-path packages/journey-swift
swift test --package-path packages/journey-swift --parallel
swift build --package-path packages/journey-swift -c release
```

The Kotlin static contract is also not compilation evidence. For
Kotlin/Android, run `packages/journey-kotlin/scripts/verify-windows.ps1` (or
the equivalent clean Gradle tasks documented by that package), then require the
approved attached-device matrix. Compiling an instrumentation APK is not a
device test.

No native package may be tagged, archived, uploaded or copied into a production
application until licence, support, security, provenance, durable-ingestion,
dogfood and platform qualification gates are approved.

## Trusted publishing

The template lives at
`../../.github/workflows/publish-journey-sdks.yml.disabled`. It must not be
renamed until all of the following are true:

- `npm-production` is protected by required reviewers;
- the npm organisation trusts that exact GitHub repository/workflow/environment;
- every SDK has an approved licence and is intentionally no longer private;
- Connected Journey release gates and the SDK release checklist are complete;
- the commit is on `main` and all required checks are green;
- the release owner has inspected the dry-run manifests and tarball checksums.

The template uses GitHub OIDC provenance and does not require a long-lived npm
token. A first release should use the non-default `next` tag. Promotion to
`latest` is a separate, explicitly approved operation after registry-installed
consumer tests pass for the complete package set.

### External npm account setup sequence

Before the first publish, complete the npm-side setup in this order:

1. Sign in to npm with the intended release-owner account and enable account
   2FA.
2. Create the `@seemplify` npm organisation if it does not already exist.
3. Confirm the release-owner account has write/owner authority for that
   organisation and the first package namespace.
4. Configure trusted publishing for the exact GitHub repository, workflow file,
   and protected `npm-production` environment that this repository records.
5. After trusted publishing is enabled, prefer npm's strongest package setting:
   require 2FA and disallow token-based publishing access where compatible with
   the chosen release method.
6. Keep the first coordinated release on the `next` dist-tag; promote to
   `latest` only after registry-installed consumer verification succeeds.

Trusted-publisher management through the npm CLI uses `npm trust`, whose
current documentation requires npm CLI `11.15.0` or newer, write permissions on
the package, and 2FA enabled on the account. If that command is unavailable,
use the npm web UI instead for the trusted-publisher setup.

As of Thursday, August 6, 2026, the current npm trusted-publishing
documentation requires npm CLI `11.5.1` or later and Node `22.14.0` or later.
This workstation is below that management baseline (`npm 11.0.0`, Node
`v22.11.0`) and does not expose `npm trust`, so trusted-publisher inspection or
configuration should be performed either through a newer npm environment or the
npm web UI. This local version gap does not by itself prove that GitHub Actions
publishes will fail, because the protected publish workflow can still run on a
newer GitHub-hosted Node 22 patch release when it is eventually enabled.

## Deprecation and incident policy

- No public deprecation clock exists before the first public release.
- The first release decision must establish a minimum announcement and support
  window. Until that decision is recorded, a public API cannot be removed from
  `latest` merely because the package is pre-`1.0`.
- Deprecations are recorded in `CHANGELOG.md`, the affected README and runtime
  diagnostics where appropriate. Diagnostics must never include payloads,
  identities or credentials.
- Security or privacy emergencies may shorten the normal window, but require an
  incident record, replacement guidance and explicit owner approval.
- Prefer `npm deprecate` with migration guidance. Do not use `npm unpublish`
  except when legal/security incident policy explicitly requires it.
- Maintain old protocol validators while retained events, SDKs or supported
  customers can still produce that protocol version.

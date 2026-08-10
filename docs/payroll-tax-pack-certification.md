# Payroll tax pack certification

Status date: 2026-08-09

This process is required before a tax pack can be marked `runnable`. A preview is not a certified payroll calculation. Country, state, province, canton, municipality, or other competent-authority rules must be implemented as separate effective-dated packs whenever the law differs.

## Reviewer team

Each runnable version requires all of the following people. The three reviewers must be different authenticated users, and the publisher must be a fourth user.

| Responsibility | Required evidence |
| --- | --- |
| Rule author | Effective-dated formulas, declared coverage, exclusions, sources, and executable fixtures |
| Tax-law reviewer | Approval tied to the exact content hash, a professional credential or engagement reference, and at least one registered primary source |
| Payroll-calculation reviewer | Independent reconciliation of employee withholding, employee statutory deductions, employer liabilities, bases, caps, rounding, and year-to-date treatment |
| Independent QA reviewer | A certified fixture-run reference covering boundaries, prior-period context, and employer cost |
| Publisher | A user who did not perform any of the three certification reviews |

The application records reviews against a SHA-256 hash of the material pack content. Editing dates, sources, fields, constants, formulas, statutory rules, coverage, or fixtures changes that hash and makes the earlier approvals stale.

Automated research agents and software engineers can collect sources and implement fixtures, but they are not represented as licensed tax professionals. Production legal approval must identify a real responsible reviewer or engagement.

Reviewer credentials are managed in the jurisdiction's reviewer registry. Only an organization owner or administrator can authorize or revoke a reviewer. Authorizations are role-specific, effective until their recorded expiry, and tied to the authenticated organization member. A tax-law authorization must use a professional licence, professional membership, or external engagement; an internal appointment alone is insufficient. A reviewer cannot authorize or revoke their own credential. Publication rechecks that the exact authorization used by each approval is still active and unexpired.

## Primary source register

Every runnable fixture must reference a source registered on the same version. Sources record their authority type and whether they are primary. A runnable primary source also records when the reviewed content was retrieved, when its legal currency was checked, and a SHA-256 digest of those exact reviewed bytes; an archive or evidence-store reference should be retained where licensing permits. Acceptable primary material includes legislation, the competent tax authority, the social-security authority, official guidance, and applicable official rulings.

Secondary commentary may explain a rule, but it cannot be the only source for a runnable pack.

## Minimum executable evidence

Every runnable version must contain source-bound cases in all six categories:

1. `zero_income`
2. `ordinary_period`
3. `threshold_boundary`
4. `high_income`
5. `year_to_date`
6. `employer_cost`

Each case must assert, to no more than one minor unit of tolerance:

- income tax withheld;
- total employee statutory deductions;
- total employer statutory liabilities.

Cases can additionally assert the exact liability-code ledger, calculation method, calculation currency, and runnable status. Liability-code assertions are exact: an unexpected or missing statutory component fails certification.

The category labels are not sufficient on their own. The validator rejects calculation-equivalent duplicate fixtures, requires explicit zeros in `zero_income`, a genuine non-zero prior context in `year_to_date`, higher gross and taxable income in `high_income`, and a positive named employer liability in `employer_cost`. A threshold group must contain exactly one case at the threshold and one on each side at precisely one declared statutory rounding unit.

All certified monetary calculations must use exact decimal arithmetic and name the legal rounding stage, rounding unit, and rounding mode. Binary floating-point intermediates and a universal two-decimal rule are not acceptable. The liability ledger must retain the authority, form or return code, filing frequency, period, due date, statutory base, rate, source reference, and rounding trace for every employee and employer amount.

Year-to-date calculations must be built from immutable, finalized prior-payment receipts rather than mutable profile totals. Each receipt records its calculation-version identifier, SHA-256 source hash, date-only UTC pay and period dates, same-day sequence, exact currency amounts, and component liabilities. The shared YTD snapshot sorts these receipts deterministically, rejects unposted or cross-currency amounts, and produces its own SHA-256 digest. A cumulative adapter must explicitly declare whether a negative current-period delta is a permitted refund, clamped to zero by law, or blocked pending review.

Country-specific certification must add cases for every material feature, including where applicable tax codes or filing status, benefits in kind, pension relief, disability or age relief, irregular payments, directors, expatriates, termination awards, ceilings and floors, multiple employments, subdivision taxes, and mid-year legal changes.

## Publication flow

1. Create or clone an organization draft.
2. Enter its effective dates, calculation currency, declared coverage, exclusions, sources, employee inputs, formulas, liability rules, and source-bound fixtures.
3. Set the intended calculation status. Use `preview_only` while any legal or calculation gap remains.
4. Run the preview and automated fixture suite. The **Run technical gates** action can record deterministic or AI-assisted evidence for identity, scope/currency, source snapshots, formula security, fixtures/liabilities, and tenant/immutability controls. AI evidence must include provider, model, and an exact output SHA-256. It never creates a human certification review or production approval. Any contradiction it reports is added to the content-hashed legal open issues and blocks publication.
5. Authorize the reviewers in **Payroll → Admin → Tax Rules → Reviewer team**.
6. Give each authorized reviewer the dedicated read-only `/tax-review/{jurisdictionId}/{versionId}` workspace. A reviewer does not need HR-admin access: the backend discloses only the exact draft, content hash, source/fixture evidence and that reviewer's own active authorization. The credential is inherited and cannot be typed into the review.
7. Resolve every requested change. Any edit invalidates approvals for the earlier content hash.
8. A separate owner or administrator publishes the version.
9. Create synthetic staff for every certified worker class and execute a browser payroll run.
10. Reconcile the payslip, statutory-liability export, employer cost, year-to-date values, and reporting-currency totals to the signed fixture report.

The backend also enforces this flow through:

- `POST /api/payroll/tax/jurisdictions/:id/reviewers`
- `POST /api/payroll/tax/jurisdictions/:id/reviewers/:authorizationId/revoke`
- `GET /api/payroll/tax/jurisdictions/:id/versions/:versionId/review-context`
- `POST /api/payroll/tax/jurisdictions/:id/versions/:versionId/automated-review`
- `POST /api/payroll/tax/jurisdictions/:id/versions/:versionId/reviews`
- `POST /api/payroll/tax/jurisdictions/:id/publish`

## Browser payroll evidence

The final browser run should capture, for each jurisdiction and supported subdivision:

- synthetic employee profile and tax elections;
- payment date and legal version selected by that date;
- gross and taxable bases, including non-cash benefits;
- income-tax method and amount;
- every employee and employer liability code;
- net pay and employer cost;
- year-to-date context before and after the run;
- payroll register and remittance export;
- approval and finalization state;
- expected versus actual values and any variance.

Browser evidence is an end-to-end validation layer, not a substitute for primary-law review or executable calculation tests.

## Quarantined implementation candidates

Source-backed country adapters are first registered in a preview-only candidate catalog. Registration pins the implementation and fixture SHA-256 digests, official source URLs, effective range, supported scope, and unresolved blockers. The catalog refuses any `runnable`, published, or production status and rejects an adapter result that attempts to set `runnable` or `postingAllowed` to true. Preview executions receive deterministic input and output digests.

This quarantine lets engineering and reviewers exercise exact calculations before a jurisdiction pack is certified. It is not a second publication path. Production payroll may use an adapter only after it is bound to a published effective-dated pack and the ordinary reviewer, fixture, currency, and publisher controls all pass.

## Release rule

A pack remains `preview_only` or `blocked` when any required national, subdivision, worker-class, benefit, year-to-date, filing, or remittance behavior is missing. Group labels such as “European Union,” “United States,” “Canada,” or “Other Americas” are not single tax jurisdictions and cannot be promoted as a shortcut around country, state, provincial, or local law.

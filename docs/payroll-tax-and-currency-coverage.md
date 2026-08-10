# Payroll tax and currency coverage

Status date: 2026-08-09

This document records calculation readiness, not merely whether a country appears in the UI. A pack marked `preview_only` may return an explainable estimate, but the payroll engine must not approve or finalize it. A pack becomes `runnable` only after its formulas, statutory bases, benefit rules, effective dates, rounding, and official boundary cases have been independently reviewed.

## Current coverage

| Jurisdiction | Pack status | Included in the current draft | Main work required before payroll certification |
| --- | --- | --- | --- |
| Ghana | Preview only / certification candidate | Quarantined 2026 adapter covering ordinary resident/non-resident PAYE, SSNIT Tier 1/Tier 2/NHIA routing, evidenced reliefs, concessionary bonus, junior overtime and prescribed vehicle/fuel benefits | Resolve official top-band and SSNIT-minimum rounding conflicts; cumulative true-ups, worker exceptions, pack binding and credentialed reviews |
| Kenya | Preview only / needs review | Legacy draft plus a quarantined 2026 monthly adapter covering PAYE, AHL, SHIF, NSSF Year 3/4, age, contracted-out Tier II, aggregate pension cap, PWD and NITA | Benefit/reimbursement valuation, annual/YTD reconciliation, NITA due-date counsel decision, pack binding, and credentialed reviews |
| Nigeria | Preview only / certification candidate | Quarantined 2026 adapter covering stable monthly cumulative PAYE, enacted deductions, pension, NHF, evidenced OPSSHIP/NHIA and NSITF, ITF provision, State/FCT route evidence and liabilities | Variable pay/starters/leavers/corrections, benefits, each State/FCT overlay, NHIA/NSITF due dates, ITF treatment, rounding sign-off, pack binding and licensed review |
| South Africa | Preview only / certification candidate | Quarantined 2027 adapter with exact SARS monthly/cumulative PAYE, all 1,635 A04 rows, age/rebate boundaries, MTC, UIF, SDL and EMP201 metadata | Bonuses/directors, benefits/allowances, AMTC/disability, ETI, expatriates, UIF/SDL exclusions, rounding counsel decision, pack binding and credentialed reviews |
| Cameroon | Dynamic-pack backlog; legacy preview only | Governed create/clone capability plus an explicitly documented module checklist; no new hard-coded adapter in the narrowed scope | Admin creates a blocked draft and supplies current Finance Law, official lookup tables, CNPS/levies, benefit valuation, dates, fixtures and reviewers |
| Mozambique | Dynamic-pack backlog; legacy preview only | Governed create/clone capability plus an explicitly documented module checklist; no new hard-coded adapter in the narrowed scope | Admin creates a blocked draft and supplies Law 11/2025 transition rules, IRPS/INSS, annual reconciliation, benefits, fixtures and reviewers |
| United Kingdom | Preview only / needs review | Quarantined 2026/27 PAYE adapter: cumulative and W1/M1, rest/Scottish/Welsh codes through D2, K/BR/0T/NT, 50% cap, refunds, FPS/remittance; 162 supported official workbook rows matched exactly | NI categories/directors, student loans, pensions/benefits, SD3, irregular/week-53+, quarterly remitters, pack binding, and credentialed reviews |
| United States | Federal preview only | Quarantined 2026 federal adapter: modern and old W-4, exempt/NRA, supplemental flat methods, FICA, Additional Medicare, FUTA, 941/940 ledger | Every state, locality, SUTA/SDI/leave and reciprocity adapter; lock-in letters, aggregate supplemental method, pack binding, and credentialed reviews |
| Canada | Ontario certification candidate; nationwide blocked | Quarantined 2026 Ontario adapter covering CRA January/July Option 1, TD1/TD1ON, CPP/CPP2, standard-rate EI, exact YTD maxima and regular-remitter PD7A metadata | Credentialed federal/Ontario reviews, pack binding, Quebec and every other province/territory, benefits, non-periodic pay, partial-year CPP, reduced EI, non-regular remitters, corrections and T4 filing |
| European Union | Blocked | EU social-security jurisdiction-selection architecture | There is no EU-wide income-tax pack. Each of the 27 national systems, plus applicable regional/local/church/sector rules, must be implemented and certified separately |
| Other Americas | Not implemented | Extensible jurisdiction-pack model | One country and, where applicable, state/province/local adapter at a time |

Seven source-backed calculation candidates are now available for controlled preview: Canada/Ontario, Ghana, Kenya, Nigeria, South Africa, United Kingdom and United States federal. No country pack is currently certified for automatic payroll finalization. This is intentional: incomplete law packs fail closed instead of silently under- or over-withholding.

Ghana and Nigeria have separate AI technical/statutory review evidence recorded in the graphical report and are engineering-approved for quarantined preview. Automated reviews approve objective gates and preserve exact content hashes, but they are explicitly not licensed professional opinions and cannot turn a known legal contradiction into production approval.

Product scope decision for this delivery: source-backed country-specific Wave 1 implementation stops after Ghana and Nigeria. The remaining requested jurisdictions use the governed dynamic create/clone workflow and the in-code rollout inventory. “Dynamic” means an administrator can create the draft without a software deployment; it does not mean the application invents rates or bypasses official sources and reviewers.

The deterministic preview matrix currently executes four synthetic staff scenarios (zero, ordinary, high-income, and prior-year-to-date) for each of the 11 seeded entries: 44 scenarios in total, with zero runnable results. This is an engineering smoke matrix, not legal certification evidence. Its machine-readable output also inventories quarantined adapters with immutable implementation/fixture digests and blockers. The dynamic rollout inventory contains 126 explicit national or first-level-subdivision entries (Cameroon and Mozambique, 27 EU members, 51 US states/DC, 13 Canadian provinces/territories, and 33 other sovereign American states), with local and sector liabilities still additional. The visual audit is `reports/payroll-tax-certification-2026-08-09.html`.

## Currency controls

- Each organization controls a functional currency, reporting currency, and enabled employee payment currencies.
- Exchange rates are immutable and effective-dated. Payroll and reports use the payment-date rate and preserve the rate identifiers used in calculation traces.
- Custom units are reporting-only and cannot be used as statutory calculation or payment currencies.
- An exact decimal statutory-money primitive now supports zero-, two-, and three-minor-unit currencies, arbitrary legal rounding units, and half-up, half-even, floor, truncate, and ceiling rules with named-stage audit history. The current legacy engine still contains floating-point/two-decimal paths, so zero- and three-decimal currencies remain reporting-only until each country adapter is migrated end to end and certified against official fixtures.
- Mixed-currency reports return per-currency buckets and reporting-currency totals. A missing payment-date rate is a blocking error rather than a zero or guessed conversion.

## Taxable pay and benefits

Pay items carry separate cash value, fair value, classification, PAYE/income-tax treatment, statutory-base memberships, evidence, and effective dates. A single `taxable` boolean is not sufficient. Statutorily taxable cash allowances and benefits cannot be weakened by an employee/month override. Unknown or unsupported classifications require review and block final payroll. Non-taxable or partially taxable treatment requires a legal reason and evidence reference, but a country pack must still encode the governing eligibility and valuation rule before it can become runnable.

## Versioning and controls

- Legal packs are effective-dated and immutable after publication.
- Payroll selects the pack effective on the pay date; employee profiles do not pin obsolete law versions.
- Published versions include official sources, source dates, a canonical content hash, coverage/exclusions, review state, and executable expected-value cases.
- A runnable pack cannot be published without successful formula compilation, semantically distinct source-bound fixtures, and current approvals from authorized tax-law, payroll-calculation, and independent-QA reviewers. A separate publisher is required.
- Reviewer authorizations are credential-backed, role-specific, effective-dated, revocable, and revalidated at publication. Edits make earlier content-hash approvals stale.
- The statutory-liability ledger contract records authority, form or return code, filing frequency, period, due date, base, rate, source, and rounding trace for employee and employer liabilities. Country adapters must populate this contract before certification.
- The statutory YTD contract accepts only exact, single-currency approved/exported/paid receipts within the declared tax year, with calculation-version IDs and immutable source hashes. It produces a deterministic snapshot digest and forces each cumulative adapter to declare its negative-delta/refund policy.
- Researched adapters enter a preview-only candidate registry first. The registry pins code and fixture digests and has no payroll-posting path; it cannot substitute for effective-dated pack publication.
- Tax, statutory deductions, negative net pay, missing FX, missing Leave data, and review-required components are blocking payroll errors.
- Approval, finalization, and retraction use auditable state transitions; finalization requires MongoDB transaction support.

## Primary sources used for the current drafts

- Ghana: [GRA PAYE](https://gra.gov.gh/domestic-tax/tax-types/paye/), [SSNIT 2026 notice](https://www.ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf)
- Kenya: [KRA PAYE](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye), [employer deductions guidance](https://www.kra.go.ke/news-center/public-notices/2307-guidance-on-employer-obligations-in-applying-income-tax-deductions%2C-reliefs-and-exemptions), [Affordable Housing Act](https://new.kenyalaw.org/akn/ke/act/2024/2/eng@2024-03-21), [SHIF Regulations](https://new.kenyalaw.org/akn/ke/act/ln/2024/49/eng@2025-02-28), [NSSF Year 4](https://www.nssf.or.ke/notice-to-employers-year-4-2026-nssf-contribution-rates)
- Nigeria: [Nigeria Tax Act 2025](https://nass.gov.ng/documents/download/11249), [Federal transition guidance](https://finance.gov.ng/federal-government-issues-transition-guidelines-for-tax-acts-2025/), [JRB 2026 guidance](https://www.jrb.gov.ng/media-center/jrb-releases-pit-guidelines-2026)
- South Africa: [SARS employer guide](https://www.sars.gov.za/wp-content/uploads/Ops/Guides/PAYE-GEN-01-G21-Guide-for-Employers-iro-Employees-Tax-for-2027-External-Guide.pdf), [UIF](https://www.sars.gov.za/latest-news/unemployment-insurance-fund-uif-contributions/), [SDL](https://www.sars.gov.za/types-of-tax/skills-development-levy/)
- Cameroon: [DGI IRPP](https://www.impots.cm/fr/document/tout-savoir-sur-lirpp), [General Tax Code](https://www.impots.cm/sites/default/files/documents/CGI%202024%20version%20francaise.pdf), [CNPS decree](https://www.cnps.cm/images/imprimes1/decret%20fixant%20taux%20de%20cotisations%20sociales%20et%20plafonds%20des%20rmunrations.pdf)
- Mozambique: [AT IRPS](https://www.at.gov.mz/por/Perguntas-Frequentes2/IRPS), [Law 11/2025 Gazette](https://inm.gov.mz/pt-br/content/suplemento-n%C2%BA-1-de-291225-pag-2180-1-20-br-n%C2%BA-248-boletim-da-rep%C3%BAblica-i-serie), [INSS](https://www.inss.gov.mz/taxa-contributiva-contribuinte/)
- United Kingdom: [2026/27 employer rates](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027), [PAYE specification](https://www.gov.uk/government/publications/payroll-technical-specifications-income-tax), [NI specification](https://www.gov.uk/government/publications/payroll-technical-specifications-national-insurance)
- United States: [IRS Publication 15-T](https://www.irs.gov/publications/p15t), [IRS Publication 15](https://www.irs.gov/publications/p15)
- Canada: [CRA T4127 January 2026](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html), [CRA July 2026 delta](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul/t4127-jul-payroll-deductions-formulas.html)
- European Union: [cross-border income-tax overview](https://europa.eu/youreurope/citizens/work/taxes/income-taxes-abroad/index_en.htm), [social-security coordination](https://employment-social-affairs.ec.europa.eu/policies-and-activities/moving-working-europe/eu-social-security-coordination/which-rules-apply-you_en)

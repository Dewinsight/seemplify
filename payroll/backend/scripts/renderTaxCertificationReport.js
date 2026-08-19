'use strict';

const fs = require('fs');
const path = require('path');

const COUNTRY_AUDIT = Object.freeze({
  GB: {
    release: 'Blocked for final payroll',
    finding: 'A quarantined 2026/27 HMRC adapter now matches all 162 supported official workbook rows. It remains blocked until credentialed review, pack binding, SD3 and irregular-period coverage are complete.',
    sources: [
      ['HMRC 2026/27 developer test data', 'https://www.gov.uk/government/publications/software-developers-payroll-test-data-2026-to-2027'],
      ['HMRC employer rates 2026/27', 'https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027'],
    ],
  },
  US: {
    release: 'Federal preview only',
    finding: 'A quarantined federal adapter now covers modern and old W-4, exempt/NRA, supplemental withholding, FICA and FUTA. Every state, DC, local and SUTA determination still requires its own effective-dated companion.',
    sources: [
      ['IRS Publication 15-T (2026)', 'https://www.irs.gov/publications/p15t'],
      ['IRS Publication 15 (2026)', 'https://www.irs.gov/publications/p15'],
    ],
  },
  NG: {
    release: 'Blocked for final payroll',
    finding: 'A quarantined 2026 adapter now covers stable monthly cumulative PAYE, enacted reliefs, pension, NHF, evidenced OPSSHIP/NHIA and NSITF, ITF provision, State/FCT routing and liability metadata. Variable pay, State/FCT overlays, due-date evidence, ITF treatment and source-silent kobo rounding remain blocked.',
    sources: [
      ['Nigeria Tax Act 2025', 'https://nass.gov.ng/documents/download/11249'],
      ['JRB 2026 PIT Guidelines', 'https://www.jrb.gov.ng/assets/2026-pit-guidelines-TJG3n9-T.pdf'],
    ],
  },
  GH: {
    release: 'Blocked for final payroll',
    finding: 'A quarantined 2026 adapter now covers ordinary PAYE, SSNIT Tier 1/Tier 2/NHIA routing, evidenced reliefs, bonus/overtime and prescribed vehicle/fuel benefits. Conflicting GRA top-band wording and SSNIT minimum rounding remain blocked.',
    sources: [
      ['Ghana Revenue Authority PAYE', 'https://gra.gov.gh/domestic-tax/tax-types/paye/'],
      ['SSNIT 2026 insurable earnings notice', 'https://www.ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf'],
    ],
  },
  KE: {
    release: 'Blocked for final payroll',
    finding: 'A quarantined monthly adapter now covers the aggregate pension cap, PWD, NITA, pensionable earnings, age and contracted-out Tier II. Benefit valuation, annual/YTD reconciliation, a NITA timing conflict and credentialed review remain blocked.',
    sources: [
      ['KRA PAYE', 'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye'],
      ['Kenya Income Tax Act', 'https://new.kenyalaw.org/akn/ke/act/1973/16/eng@2026-01-01'],
    ],
  },
  ZA: {
    release: 'Blocked for final payroll',
    finding: 'A quarantined 2027 adapter now covers exact SARS monthly and cumulative PAYE, all 1,635 A04 rows, age/rebate boundaries, MTC, UIF, SDL and EMP201 metadata. Bonuses/directors, benefits, AMTC and credentialed review remain blocked.',
    sources: [
      ['SARS 2027 employer guide', 'https://www.sars.gov.za/wp-content/uploads/Ops/Guides/PAYE-GEN-01-G21-Guide-for-Employers-iro-Employees-Tax-for-2027-External-Guide.pdf'],
      ['SARS Skills Development Levy', 'https://www.sars.gov.za/types-of-tax/skills-development-levy/'],
    ],
  },
  CM: {
    release: 'Dynamic-pack backlog',
    finding: 'The legacy preview remains non-certifying. A governed administrator can create or clone a blocked Cameroon draft and supply current DGI/CNPS sources, exact XAF rounding, IRPP/CAC, TDL, CFC/FNE, CRTV, benefits, fixtures and reviewers without a code deployment.',
    sources: [
      ['Cameroon DGI IRPP', 'https://www.impots.cm/fr/document/tout-savoir-sur-lirpp'],
      ['Cameroon General Tax Code', 'https://www.impots.cm/sites/default/files/documents/CGI%202024%20version%20francaise.pdf'],
    ],
  },
  MZ: {
    release: 'Dynamic-pack backlog',
    finding: 'The legacy monthly table remains non-certifying. A governed administrator can create or clone a blocked Mozambique draft and supply current IRPS/INSS law, whole-metical rounding, annual reconciliation, 13th-month/holiday cases, fixtures and reviewers without a code deployment.',
    sources: [
      ['Mozambique Law 11/2025 gazette', 'https://inm.gov.mz/pt-br/content/suplemento-n%C2%BA-1-de-291225-pag-2180-1-20-br-n%C2%BA-248-boletim-da-rep%C3%BAblica-i-serie'],
      ['Mozambique Tax Authority IRPS', 'https://www.at.gov.mz/por/Perguntas-Frequentes2/IRPS'],
    ],
  },
  CA: {
    release: 'Ontario candidate; Canada blocked',
    finding: 'A quarantined Ontario adapter now implements CRA January/July Option 1, TD1/TD1ON, CPP/CPP2, EI and regular-remitter PD7A metadata. Credentialed review, Quebec and every other province/territory, benefits, non-periodic pay and non-regular remitters remain blocked.',
    sources: [
      ['CRA T4127 January 2026', 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html'],
      ['CRA T4127 July 2026', 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul/t4127-jul-payroll-deductions-formulas.html'],
    ],
  },
  EU: {
    release: 'Blocked',
    finding: 'The EU is not one income-tax jurisdiction. Twenty-seven national packs plus applicable regional/local/church rules and EU social-security applicable-law selection are required.',
    sources: [
      ['EU applicable social-security rules', 'https://employment-social-affairs.ec.europa.eu/policies-and-activities/moving-working-europe/eu-social-security-coordination/which-rules-apply-you_en'],
      ['EU cross-border income-tax overview', 'https://europa.eu/youreurope/citizens/work/taxes/income-taxes-abroad/index_en.htm'],
    ],
  },
  OTHER: {
    release: 'Blocked',
    finding: 'A generic Americas or custom-country percentage is not a legal payroll adapter. Each sovereign, state/province and local liability must be separately sourced and certified.',
    sources: [],
  },
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value, currency) {
  if (!currency) return String(value ?? 0);
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  } catch (_) {
    return `${currency} ${Number(value || 0).toLocaleString('en-GB')}`;
  }
}

function sumObject(input = {}) {
  return Object.values(input).reduce((sum, value) => sum + Number(value || 0), 0);
}

function renderSources(sources = []) {
  if (!sources.length) return '<span class="muted">Country sources not yet registered</span>';
  return sources.map(([label, href]) => (
    `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
  )).join('<span class="dot">·</span>');
}

function renderReport(report) {
  const ordinary = report.results.filter((entry) => entry.fixture === 'ordinary_period');
  const adapterCandidates = Array.isArray(report.adapterCandidates) ? report.adapterCandidates : [];
  const independentAiReviews = Array.isArray(report.independentAiReviews) ? report.independentAiReviews : [];
  const rolloutInventory = Array.isArray(report.rolloutInventory) ? report.rolloutInventory : [];
  const rolloutEntryCount = rolloutInventory.reduce((total, group) => total + group.entries.length, 0);
  const rolloutRunnableCount = rolloutInventory.reduce((total, group) => total + group.runnableCount, 0);
  const runnableCount = ordinary.filter((entry) => entry.configuredStatus === 'runnable').length;
  const blockedCount = ordinary.filter((entry) => entry.configuredStatus === 'blocked').length;
  const maxTaxRate = Math.max(1, ...ordinary.map((entry) => (
    entry.grossPay > 0 ? (Number(entry.incomeTax || 0) / Number(entry.grossPay)) * 100 : 0
  )));

  const rows = ordinary.map((entry) => {
    const audit = COUNTRY_AUDIT[entry.countryCode] || COUNTRY_AUDIT.OTHER;
    const effectiveTaxRate = entry.grossPay > 0
      ? (Number(entry.incomeTax || 0) / Number(entry.grossPay)) * 100
      : 0;
    const barWidth = Math.max(0, Math.min(100, (effectiveTaxRate / maxTaxRate) * 100));
    const employeeTotal = sumObject(entry.employeeLiabilities);
    const employerTotal = sumObject(entry.employerLiabilities);
    return `
      <article class="country-row" id="country-${escapeHtml(entry.countryCode)}">
        <div class="country-title">
          <span class="code">${escapeHtml(entry.countryCode)}</span>
          <div><h3>${escapeHtml(entry.countryName)}</h3><p>${escapeHtml(entry.packKey)}</p></div>
        </div>
        <div class="status-cell">
          <span class="status ${entry.configuredStatus === 'blocked' ? 'blocked' : 'candidate'}">${escapeHtml(entry.configuredStatus.replace('_', ' '))}</span>
          <strong>${escapeHtml(entry.payrollRunnable ? 'Platform release' : audit.release)}</strong>
        </div>
        <div class="numbers">
          <span><small>Synthetic gross</small>${escapeHtml(money(entry.grossPay, entry.calculationCurrency))}</span>
          <span><small>Calculated income tax</small>${escapeHtml(money(entry.incomeTax, entry.calculationCurrency))}</span>
          <span><small>Employee statutory</small>${escapeHtml(money(employeeTotal, entry.calculationCurrency))}</span>
          <span><small>Employer statutory</small>${escapeHtml(money(employerTotal, entry.calculationCurrency))}</span>
          <div class="rate"><i style="width:${barWidth.toFixed(2)}%"></i></div>
          <small>${effectiveTaxRate.toFixed(2)}% tax-to-gross in the release fixture</small>
        </div>
        <div class="finding">
          <p>${escapeHtml(audit.finding)}</p>
          <div class="sources">${renderSources(audit.sources)}</div>
        </div>
      </article>`;
  }).join('');

  const candidateRows = adapterCandidates.map((candidate) => `
    <article class="candidate-row">
      <div class="candidate-identity">
        <span class="code">${escapeHtml(candidate.countryCode)}</span>
        <div><h3>${escapeHtml(candidate.displayName)}</h3><p>${escapeHtml(candidate.id)}</p></div>
      </div>
      <div class="candidate-state">
        <span class="status candidate">quarantined candidate</span>
        <small>${escapeHtml(candidate.effectiveFrom)} to ${escapeHtml(candidate.effectiveTo)}</small>
        <code>${escapeHtml(candidate.implementationDigestSha256.slice(0, 12))}</code>
      </div>
      <div>
        <b>Verified implementation scope</b>
        <ul>${candidate.supportedScope.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        ${candidate.goldenEvidence?.length ? `<b>Executed golden evidence</b><ul>${candidate.goldenEvidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
        <small>Fixture suite: ${escapeHtml(candidate.fixtureSuite)}</small>
      </div>
      <div>
        <b>Still blocking payroll posting</b>
        <ul class="blocker-list">${candidate.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <div class="sources">${candidate.officialSources.map((href) => (
          `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Official source</a>`
        )).join('<span class="dot">&middot;</span>')}</div>
      </div>
    </article>`).join('');

  const rolloutRows = rolloutInventory.map((group) => `
    <details class="rollout-group">
      <summary>
        <span><b>${escapeHtml(group.label)}</b><small>${group.entries.length} explicit jurisdictions</small></span>
        <span class="rollout-count"><strong>${group.candidateCount}</strong> candidates &middot; <strong>${group.runnableCount}</strong> runnable</span>
      </summary>
      <p>${escapeHtml(group.additionalScope)}</p>
      <div class="jurisdiction-chips">${group.entries.map((item) => (
        `<span class="jurisdiction-chip ${item.implementationStatus === 'certification_candidate' ? 'is-candidate' : ''}"><code>${escapeHtml(item.code)}</code>${escapeHtml(item.name)}</span>`
      )).join('')}</div>
      <a class="inventory-source" href="${escapeHtml(group.source)}" target="_blank" rel="noreferrer">Official jurisdiction inventory</a>
    </details>`).join('');

  const independentReviewRows = independentAiReviews.map((review) => `
    <article class="review-card">
      <div class="review-title">
        <span class="code">${escapeHtml(review.adapterId.slice(0, 2))}</span>
        <div><h3>${escapeHtml(review.jurisdiction)}</h3><p>${escapeHtml(review.adapterId)}</p></div>
        <span class="status candidate">preview approved</span>
      </div>
      <p>${escapeHtml(review.summary)}</p>
      <div class="review-evidence"><b>Independent evidence</b><span>${escapeHtml(review.testEvidence)}</span></div>
      <div class="review-columns">
        <div><b>Passed automatically</b><ul>${review.passedGates.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
        <div><b>Still fail-closed</b><ul class="blocker-list">${review.blockedGates.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
      </div>
      <footer><span>${escapeHtml(review.reviewer)}</span><code>${escapeHtml(review.reviewedContentHashSha256.slice(0, 16))}</code></footer>
      <small>AI-generated technical/statutory review; not a licensed tax-professional opinion. Production approval: no.</small>
    </article>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payroll tax certification — ${escapeHtml(report.generatedAt.slice(0, 10))}</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#64707d; --line:#dfe4e8; --paper:#f5f6f7; --card:#fff; --red:#a52a2a; --red-bg:#fff1ef; --amber:#8a5a00; --amber-bg:#fff8e6; --blue:#215a8a; --green:#196b45; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width:min(1480px, calc(100% - 40px)); margin:28px auto 64px; }
    header { border:1px solid var(--line); background:var(--card); padding:28px; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:28px; align-items:start; }
    h1 { margin:0 0 8px; font-size:28px; letter-spacing:-.035em; }
    h2 { margin:0; font-size:16px; }
    h3 { margin:0; font-size:14px; }
    p { margin:0; }
    .eyebrow { color:var(--blue); font-size:11px; font-weight:750; letter-spacing:.12em; text-transform:uppercase; }
    .lede { max-width:800px; color:var(--muted); font-size:15px; }
    .verdict { border-left:3px solid var(--red); padding:2px 0 2px 14px; min-width:260px; }
    .verdict strong { display:block; color:var(--red); font-size:18px; }
    .verdict span { color:var(--muted); }
    .metrics { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); border:1px solid var(--line); border-top:0; background:var(--card); }
    .metric { padding:18px 20px; border-right:1px solid var(--line); }
    .metric:last-child { border-right:0; }
    .metric strong { display:block; font-size:24px; letter-spacing:-.04em; }
    .metric span, small, .muted { color:var(--muted); }
    .section { margin-top:22px; border:1px solid var(--line); background:var(--card); }
    .section-head { padding:18px 20px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:20px; align-items:end; }
    .section-head p { color:var(--muted); max-width:800px; }
    .country-row { display:grid; grid-template-columns:220px 210px 300px minmax(300px,1fr); gap:22px; padding:18px 20px; border-bottom:1px solid var(--line); align-items:start; }
    .country-row:last-child { border-bottom:0; }
    .country-title { display:flex; gap:12px; align-items:flex-start; }
    .country-title p { color:var(--muted); font-size:12px; margin-top:3px; }
    .code { display:inline-grid; place-items:center; width:38px; height:28px; border:1px solid var(--line); background:#f9fafb; font:700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .status-cell { display:flex; flex-direction:column; align-items:flex-start; gap:7px; }
    .status { display:inline-flex; border:1px solid; padding:3px 7px; font-size:10px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .status.preview { color:var(--amber); background:var(--amber-bg); border-color:#ead49a; }
    .status.blocked { color:var(--red); background:var(--red-bg); border-color:#e7b8b1; }
    .status.candidate { color:var(--blue); background:#eef6fc; border-color:#b7cde0; }
    .status-cell strong { font-size:12px; }
    .numbers { display:grid; grid-template-columns:1fr 1fr; gap:8px 14px; }
    .numbers span { font-weight:700; }
    .numbers small { display:block; font-weight:500; }
    .rate { grid-column:1/-1; height:4px; background:#e9edf0; margin-top:4px; overflow:hidden; }
    .rate i { display:block; height:100%; background:var(--blue); }
    .numbers > small { grid-column:1/-1; }
    .finding p { margin-bottom:8px; }
    .sources { display:flex; flex-wrap:wrap; gap:5px; font-size:12px; }
    .sources a { color:var(--blue); text-decoration:none; border-bottom:1px solid #b7cde0; }
    .dot { color:#9aa3ab; }
    .candidate-row { display:grid; grid-template-columns:240px 190px minmax(280px,1fr) minmax(320px,1.25fr); gap:22px; padding:18px 20px; border-bottom:1px solid var(--line); align-items:start; }
    .candidate-row:last-child { border-bottom:0; }
    .candidate-identity { display:flex; gap:12px; align-items:flex-start; }
    .candidate-identity p { color:var(--muted); font:11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; margin-top:4px; overflow-wrap:anywhere; }
    .candidate-state { display:flex; flex-direction:column; align-items:flex-start; gap:7px; }
    .candidate-state code { color:var(--muted); font-size:11px; }
    .candidate-row b { display:block; margin-bottom:6px; }
    .candidate-row ul { margin:0 0 7px; padding-left:17px; }
    .candidate-row li { margin:3px 0; }
    .blocker-list { color:#6f2a25; }
    .review-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
    .review-card { padding:20px; border-right:1px solid var(--line); }
    .review-card:last-child { border-right:0; }
    .review-title { display:flex; gap:12px; align-items:flex-start; margin-bottom:12px; }
    .review-title p { color:var(--muted); font:11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .review-title .status { margin-left:auto; }
    .review-evidence { display:grid; gap:3px; border-block:1px solid var(--line); padding:11px 0; margin:13px 0; }
    .review-evidence span { color:var(--muted); }
    .review-columns { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    .review-columns b { display:block; margin-bottom:5px; }
    .review-columns ul { margin:0; padding-left:17px; }
    .review-card footer { margin:14px 0 5px; padding-top:10px; border-top:1px solid var(--line); }
    .rollout-group { border-bottom:1px solid var(--line); }
    .rollout-group:last-child { border-bottom:0; }
    .rollout-group summary { cursor:pointer; padding:16px 20px; display:flex; justify-content:space-between; gap:20px; align-items:center; }
    .rollout-group summary span:first-child { display:flex; flex-direction:column; }
    .rollout-group summary small { margin-top:2px; }
    .rollout-count { color:var(--muted); font-size:12px; white-space:nowrap; }
    .rollout-count strong { color:var(--ink); }
    .rollout-group > p { color:var(--muted); padding:0 20px 12px; }
    .jurisdiction-chips { display:flex; flex-wrap:wrap; gap:6px; padding:0 20px 14px; }
    .jurisdiction-chip { display:inline-flex; gap:6px; align-items:center; border:1px solid var(--line); background:#fafbfc; padding:4px 7px; font-size:11px; }
    .jurisdiction-chip code { color:var(--muted); }
    .jurisdiction-chip.is-candidate { color:var(--blue); border-color:#b7cde0; background:#eef6fc; }
    .inventory-source { display:inline-block; margin:0 20px 16px; color:var(--blue); font-size:12px; text-decoration:none; border-bottom:1px solid #b7cde0; }
    .browser-evidence { display:grid; grid-template-columns:repeat(3,1fr); }
    .browser-evidence > div { padding:18px 20px; border-right:1px solid var(--line); }
    .browser-evidence > div:last-child { border-right:0; }
    .browser-evidence b { display:block; margin-bottom:5px; }
    .browser-evidence span { color:var(--muted); }
    .gates { display:grid; grid-template-columns:repeat(4,1fr); }
    .gate { padding:18px 20px; border-right:1px solid var(--line); }
    .gate:last-child { border-right:0; }
    .gate b { display:block; margin-bottom:5px; }
    .gate span { color:var(--muted); }
    footer { margin-top:18px; color:var(--muted); font-size:12px; display:flex; justify-content:space-between; gap:20px; }
    @media (max-width:1100px) { .country-row { grid-template-columns:180px 180px 1fr; } .finding { grid-column:1/-1; } .candidate-row { grid-template-columns:200px 180px 1fr; } .candidate-row > :last-child { grid-column:1/-1; } .metrics { grid-template-columns:repeat(3,1fr); } .metric { border-bottom:1px solid var(--line); } }
    @media (max-width:720px) { main { width:calc(100% - 20px); margin-top:10px; } header { grid-template-columns:1fr; } .metrics,.gates,.browser-evidence,.review-grid { grid-template-columns:1fr; } .country-row,.candidate-row { grid-template-columns:1fr; } .finding,.candidate-row > :last-child { grid-column:auto; } .review-card { border-right:0; border-bottom:1px solid var(--line); } }
    @media print { body { background:#fff; } main { width:100%; margin:0; } .country-row { break-inside:avoid; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="eyebrow">Payroll statutory certification</div>
        <h1>Global tax-pack readiness</h1>
        <p class="lede">A source-led release report for the current payroll engine. Platform-owned packs are published from immutable implementation and fixture evidence; organization-authored overrides keep independent review controls.</p>
      </div>
      <div class="verdict"><strong>${runnableCount} packs released</strong><span>Incomplete templates remain fail-closed.</span></div>
    </header>
    <section class="metrics" aria-label="Certification metrics">
      <div class="metric"><strong>${ordinary.length}</strong><span>seeded jurisdiction entries</span></div>
      <div class="metric"><strong>${runnableCount}</strong><span>platform releases</span></div>
      <div class="metric"><strong>${blockedCount}</strong><span>blocked templates</span></div>
      <div class="metric"><strong>${adapterCandidates.length}</strong><span>quarantined statutory adapters</span></div>
      <div class="metric"><strong>${report.scenarios}</strong><span>synthetic smoke scenarios</span></div>
      <div class="metric"><strong>${report.runnableScenarios}</strong><span>runnable scenarios</span></div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Quarantined statutory adapters</h2><p>These are exact, source-backed implementation candidates with immutable code and fixture digests. The preview registry has no payroll-posting path; certification and effective-dated pack binding are separate controls.</p></div><span class="status candidate">posting disabled</span></div>
      ${candidateRows || '<div class="gate"><span>No researched adapter candidates registered.</span></div>'}
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Independent automated reviews</h2><p>Separate AI review agents checked Ghana and Nigeria against primary sources, executable fixtures, and independent arithmetic. The engineering approver automatically accepted passed gates for preview; unresolved legal gates remain blocked.</p></div><span class="status candidate">${independentAiReviews.length} reviews recorded</span></div>
      <div class="review-grid">${independentReviewRows || '<div class="gate"><span>No independent AI reviews recorded.</span></div>'}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Country and subdivision rollout inventory</h2><p>Broad product labels are expanded into the actual national and subnational adapters required. Open a group to inspect every explicit jurisdiction; local and sector liabilities may add more.</p></div><span class="status blocked">${rolloutEntryCount} entries &middot; ${rolloutRunnableCount} runnable</span></div>
      ${rolloutRows || '<div class="gate"><span>No rollout inventory generated.</span></div>'}
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Release gates</h2><p>Platform packs require deterministic evidence against the same immutable content hash. Custom rules retain the reviewer workflow.</p></div><span class="status candidate">platform releases active</span></div>
      <div class="gates">
        <div class="gate"><b>Tax-law reviewer</b><span>Current primary law, scope, effective dates and legal interpretation. AI evidence assists but does not impersonate a licensed reviewer.</span></div>
        <div class="gate"><b>Payroll-calculation reviewer</b><span>Bases, ordering, eligibility, proration, rounding and remittance mapping.</span></div>
        <div class="gate"><b>Independent QA</b><span>Official zero, ordinary, YTD, high-income, boundary and employer-cost goldens.</span></div>
        <div class="gate"><b>Separate publisher</b><span>Cannot be the author or any reviewer; publication rechecks current credentials.</span></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Browser payroll verification</h2><p>The live signed-in Payroll tenant was inspected on 2026-08-09. Browser evidence is recorded separately from calculation fixtures.</p></div><span class="status blocked">pay run not authorized</span></div>
      <div class="browser-evidence">
        <div><b>Session</b><span>The signed-in AIIN organization reached the Tax Rules screen successfully.</span></div>
        <div><b>Authorization boundary</b><span>The screen returned “HR Admin access required” and no jurisdiction was available. The test did not bypass that control.</span></div>
        <div><b>Payroll-run outcome</b><span>No statutory browser payroll was finalized because there are zero certified packs and this session cannot administer tax rules. Adapter goldens remain non-postable.</span></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Jurisdiction evidence</h2><p>Ordinary deterministic fixtures show the exact released calculation result; blocked templates remain visible as unsupported scope.</p></div><span>${escapeHtml(report.generatedAt.slice(0, 10))}</span></div>
      ${rows}
    </section>

    <footer><span>${escapeHtml(report.warning)}</span><span>Generated from payroll-tax-preview-matrix.json</span></footer>
  </main>
</body>
</html>`;
}

function main() {
  const repositoryRoot = path.resolve(__dirname, '../../..');
  const inputPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(repositoryRoot, 'reports', 'payroll-tax-preview-matrix.json');
  const outputPath = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : path.join(repositoryRoot, 'reports', 'payroll-tax-certification-2026-08-09.html');
  const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderReport(report), 'utf8');
  process.stdout.write(`${JSON.stringify({ inputPath, outputPath, jurisdictions: report.packs, scenarios: report.scenarios })}\n`);
}

if (require.main === module) main();

module.exports = { renderReport, COUNTRY_AUDIT };

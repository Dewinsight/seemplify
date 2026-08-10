export type PageGuideLink = {
  href: string;
  label: string;
};

export type PageGuideDefinition = {
  id: string;
  title: string;
  audience: string;
  summary: string;
  steps: string[];
  checks: string[];
  tips?: string[];
  related?: PageGuideLink[];
};

type RouteGuideMatcher = {
  pattern: RegExp;
  guide: PageGuideDefinition;
};

const guides: RouteGuideMatcher[] = [
  {
    pattern: /^\/login$/,
    guide: {
      id: 'login',
      title: 'Login Guide',
      audience: 'All payroll users',
      summary: 'Use this page to enter Payroll Management through Seemplify Identity. You do not create or manage a separate payroll password here.',
      steps: [
        'Click the sign-in action and complete authentication in the Identity Provider.',
        'Return to payroll after the redirect completes and let the app load your organization context.',
        'If you belong to multiple organizations, confirm you are in the correct one after login.',
      ],
      checks: [
        'You can see the payroll workspace after sign-in.',
        'Your organization and role look correct once you land.',
      ],
      tips: [
        'If access fails, confirm the account belongs to an organization with payroll enabled.',
        'If you keep looping back here, the session or token callback likely did not complete.',
      ],
    },
  },
  {
    pattern: /^\/dashboard$/,
    guide: {
      id: 'dashboard',
      title: 'Dashboard Guide',
      audience: 'Employees and payroll admins',
      summary: 'This is the payroll home page. It is the fastest place to see what needs action and jump into the next workflow.',
      steps: [
        'Review the top summary cards first to see payroll health, payslip totals, and open work.',
        'If you are an HR admin, switch between Admin View and Personal View depending on whether you are operating payroll or checking your own records.',
        'Use the large shortcut cards to move into employees, approvals, run payroll, or run history.',
      ],
      checks: [
        'Admins: employee setup blockers and pending approvals are under control before you run payroll.',
        'Employees: your payslips and requests look current.',
      ],
      tips: [
        'If numbers look wrong, check the selected organization first.',
        'Use this page as the hub, not the place to make detailed edits.',
      ],
      related: [
        { href: '/admin/employees', label: 'Employee Management' },
        { href: '/admin/run', label: 'Run Payroll' },
        { href: '/payslips', label: 'My Payslips' },
      ],
    },
  },
  {
    pattern: /^\/admin\/analytics$/,
    guide: {
      id: 'admin-analytics',
      title: 'Payroll Analytics Guide',
      audience: 'HR admins',
      summary: 'Use this page to understand payroll trends, workforce shape, and department-level cost movement across the organization.',
      steps: [
        'Choose the year you want to review before interpreting any totals or trends.',
        'Switch between Overview, Departments, and Workforce tabs to move from headline trends into staffing detail.',
        'Use refresh if payroll runs, headcount, or department data changed recently.',
      ],
      checks: [
        'Monthly gross and net payroll trends match your expected payroll cycle.',
        'Department totals and employee counts look reasonable before exporting or sharing insights.',
      ],
      tips: [
        'This page is for analysis, not adjustments. Fix underlying data in employee setup, approvals, or payroll runs.',
      ],
      related: [
        { href: '/admin/reports', label: 'Reports' },
        { href: '/admin/employees', label: 'Employees' },
      ],
    },
  },
  {
    pattern: /^\/admin\/approvals$/,
    guide: {
      id: 'admin-approvals',
      title: 'Approvals Guide',
      audience: 'HR admins',
      summary: 'This queue is where compensation changes are reviewed before they are allowed into payroll calculations.',
      steps: [
        'Keep the filter on Pending when you are working the active queue.',
        'Open each request with the amount, reason, and approval history in mind before deciding.',
        'Approve valid requests so payroll can pick them up, or reject them with a clear reason when they should not be processed.',
      ],
      checks: [
        'Only approved changes should reach payroll.',
        'Rejected requests have a clear explanation for audit and employee follow-up.',
      ],
      tips: [
        'Clear this queue before starting a payroll run if you want those items included.',
      ],
      related: [
        { href: '/admin/run', label: 'Run Payroll' },
        { href: '/requests', label: 'Employee Requests' },
      ],
    },
  },
  {
    pattern: /^\/admin\/currencies$/,
    guide: {
      id: 'admin-currencies',
      title: 'Currencies Guide',
      audience: 'HR admins',
      summary: 'Manage exchange rates here when your organization pays employees in more than one currency or wants a reporting roll-up currency.',
      steps: [
        'Check the sync status and provider settings first to see whether rates are being maintained automatically.',
        'Use manual overrides only when a specific rate must differ from the provider feed.',
        'Test conversions in the converter so reporting and payroll summaries behave as expected.',
      ],
      checks: [
        'The base currency and active rates reflect your reporting needs.',
        'Any manual override has a business reason and up-to-date value.',
      ],
      tips: [
        'Rates affect reporting roll-ups. Employee payslips still calculate in each employee payroll currency.',
      ],
      related: [
        { href: '/admin/run', label: 'Run Payroll' },
      ],
    },
  },
  {
    pattern: /^\/admin\/employees$/,
    guide: {
      id: 'admin-employees',
      title: 'Employee Management Guide',
      audience: 'HR admins',
      summary: 'This page is the payroll readiness queue for employees synchronized from the Identity Provider. Use it to find people blocked by onboarding or missing payroll configuration.',
      steps: [
        'Search or filter by setup status, team, or department to narrow the list.',
        'Resolve onboarding blockers from the employee card when someone is not fully onboarded.',
        'Open payroll setup for employees who need salary, tax, allowance, bank, or deduction details.',
        'Use the payroll exclusion checkbox to confirm who should stay out of the next run.',
      ],
      checks: [
        'Every employee included in payroll is fully onboarded.',
        'Employees with incomplete setup stay excluded until they are ready.',
      ],
      tips: [
        'Treat this page as the final readiness check before payroll calculation.',
      ],
      related: [
        { href: '/admin/run', label: 'Run Payroll' },
        { href: '/admin/settings/tax', label: 'Tax Rules' },
      ],
    },
  },
  {
    pattern: /^\/admin\/employees\/configure\/[^/]+$/,
    guide: {
      id: 'admin-employee-payroll-configure',
      title: 'Payroll Configuration Sync Guide',
      audience: 'HR admins',
      summary: 'This page verifies the existing Identity Provider member, initializes their payroll-only configuration, and then opens the full payroll setup screen.',
      steps: [
        'Wait for Identity Provider verification and payroll configuration sync to complete.',
        'If the import succeeds, continue in the employee setup screen that opens next.',
        'If it fails, go back to Employee Management and confirm the employee exists in the organization and IDP sync is available.',
      ],
      checks: [
        'The employee lands in payroll setup without an import error.',
      ],
      related: [
        { href: '/admin/employees', label: 'Employee Management' },
      ],
    },
  },
  {
    pattern: /^\/admin\/employees\/[^/]+$/,
    guide: {
      id: 'admin-employee-detail',
      title: 'Employee Setup Guide',
      audience: 'HR admins',
      summary: 'This is the detailed payroll setup page for one employee. Complete it from top to bottom so the employee can be paid correctly.',
      steps: [
        'Start with the Setup Status panel to see which payroll requirements are still incomplete.',
        'Review employee details and sync-backed identity data before you change compensation.',
        'Set compensation, currency, allowances, recurring deductions, and bank details in order.',
        'Choose the right tax jurisdiction, complete any required employee tax fields, and use the tax preview before saving.',
        'Confirm payroll flags, active status, and inclusion in next run once the setup is complete.',
      ],
      checks: [
        'Basic salary is set and bank details are valid if the employee will be paid.',
        'Tax preview does not show validation errors for the selected jurisdiction.',
        'The employee should be included in payroll only when onboarding and setup are complete.',
      ],
      tips: [
        'Save after major changes so payroll, tax preview, and run eligibility stay aligned.',
        'Use the setup page to fix the cause, not the run page after payroll has already been calculated.',
      ],
      related: [
        { href: '/admin/employees', label: 'Back to Employees' },
        { href: '/admin/settings/tax', label: 'Manage Tax Rules' },
      ],
    },
  },
  {
    pattern: /^\/admin\/reports$/,
    guide: {
      id: 'admin-reports',
      title: 'Reports Guide',
      audience: 'HR admins',
      summary: 'Use reports to review year-to-date payroll totals and export accountant-friendly summaries.',
      steps: [
        'Pick the reporting year first.',
        'Switch between Summary, Department, and Monthly views depending on the question you are answering.',
        'Export CSV when you need to work outside payroll or send data to finance.',
      ],
      checks: [
        'The selected year matches the reporting period you intend to export.',
        'Department and monthly totals match approved payroll activity.',
      ],
      tips: [
        'If a report looks off, verify the underlying payroll runs before exporting.',
      ],
      related: [
        { href: '/admin/runs', label: 'Payroll Runs' },
        { href: '/admin/analytics', label: 'Analytics' },
      ],
    },
  },
  {
    pattern: /^\/admin\/run$/,
    guide: {
      id: 'admin-run-payroll',
      title: 'Run Payroll Guide',
      audience: 'HR admins',
      summary: 'This page starts a payroll calculation for a pay period. It creates draft payslips for review; it does not execute bank payouts.',
      steps: [
        'Choose the correct payroll month, year, and payment date.',
        'Review the calculation options so you are clear about whether allowances, overtime, bonus items, tax, leave, and proration are included.',
        'Set a reporting currency if you need a single roll-up total across multiple employee currencies.',
        'Start the run only after employee setup blockers and approval queues are already resolved.',
      ],
      checks: [
        'Employees are payroll-ready before you calculate.',
        'The option toggles match what should be included in this cycle.',
      ],
      tips: [
        'If you are unsure, calculate first and review the draft run details before approving anything.',
      ],
      related: [
        { href: '/admin/employees?setup=pending', label: 'Setup Queue' },
        { href: '/admin/approvals', label: 'Approvals' },
      ],
    },
  },
  {
    pattern: /^\/admin\/runs$/,
    guide: {
      id: 'admin-runs',
      title: 'Payroll Run History Guide',
      audience: 'HR admins',
      summary: 'This page shows every payroll run and its lifecycle so you can track progress, status, and payroll totals over time.',
      steps: [
        'Use the status badge to identify whether a run is draft, pending review, pending approval, approved, exported, paid, or cancelled.',
        'Open a run to inspect payslips, exceptions, exports, and next actions.',
        'Start a new run only when the current period is genuinely ready.',
      ],
      checks: [
        'You understand the latest run status before starting another one.',
        'Gross and net totals look consistent with the pay period.',
      ],
      related: [
        { href: '/admin/run', label: 'New Payroll Run' },
      ],
    },
  },
  {
    pattern: /^\/admin\/runs\/[^/]+$/,
    guide: {
      id: 'admin-run-detail',
      title: 'Payroll Run Detail Guide',
      audience: 'HR admins',
      summary: 'This page is the control room for one payroll run. Review totals, fix exceptions, and move the run through approval and export.',
      steps: [
        'Review the run summary and currency breakdown first so you know the payroll result before acting.',
        'Check the Exceptions section and resolve skipped or errored employees before relying on the run.',
        'Use Recalculate if profile data or approved requests changed after the draft was created.',
        'Submit for approval, approve, and finalize in order based on the current run status.',
        'Download CSV or payslip PDFs when finance or employees need outputs.',
      ],
      checks: [
        'No unresolved exceptions remain when you are approving the run.',
        'You understand that approval makes payslips visible to employees.',
        'Retraction is used only for genuine corrections and always with an audit reason.',
      ],
      tips: [
        'This page reflects the run snapshot. If employee setup is wrong, fix the employee and then recalculate.',
      ],
      related: [
        { href: '/admin/runs', label: 'Back to Run History' },
        { href: '/admin/employees', label: 'Employee Management' },
      ],
    },
  },
  {
    pattern: /^\/admin\/salary-grades$/,
    guide: {
      id: 'admin-salary-grades',
      title: 'Salary Grades Guide',
      audience: 'HR admins',
      summary: 'Use salary grades to define pay bands and keep compensation ranges consistent across roles or departments.',
      steps: [
        'Create a grade code, name, and level that fit your internal compensation structure.',
        'Set the minimum and maximum range carefully so the midpoint is meaningful.',
        'Assign a department only when the grade is department-specific; otherwise leave it broad.',
        'Edit or deactivate grades when your compensation framework changes.',
      ],
      checks: [
        'Ranges are in the right currency and reflect approved compensation policy.',
        'Duplicate or obsolete grades are cleaned up before reuse.',
      ],
      related: [
        { href: '/admin/employees', label: 'Employees' },
      ],
    },
  },
  {
    pattern: /^\/admin\/settings\/tax$/,
    guide: {
      id: 'admin-tax-settings',
      title: 'Tax Rules Guide',
      audience: 'HR admins',
      summary: 'This page is where payroll tax rules are managed as configurable, versioned jurisdictions instead of hardcoded logic.',
      steps: [
        'Start from a seeded jurisdiction when possible, then clone it into an organization rule before editing.',
        'Edit field definitions, constants, income-tax logic, statutory rules, and notes in draft mode.',
        'Use the preview sandbox to test sample inputs before publishing a version.',
        'Publish only the version you want employee tax previews and payroll runs to use.',
      ],
      checks: [
        'The rule version is published only after preview and review.',
        'Jurisdiction fields match the data employees are expected to provide.',
      ],
      tips: [
        'Global seeded rules are your baseline. Organization rules are where local overrides should live.',
      ],
      related: [
        { href: '/admin/employees', label: 'Employee Setup' },
      ],
    },
  },
  {
    pattern: /^\/payslips$/,
    guide: {
      id: 'payslips',
      title: 'Payslips Guide',
      audience: 'Employees and payroll admins checking personal records',
      summary: 'Use this page to review approved payroll statements and download them as PDFs.',
      steps: [
        'Open the latest payslip first and compare gross pay, deductions, and net pay.',
        'Use the PDF download action when you need a formal copy for records or external use.',
        'If you do not see a recent payslip, confirm that payroll for that period has been approved or exported.',
      ],
      checks: [
        'The payment period and net pay match your expectation.',
        'Questions are raised early if a payslip is missing or incorrect.',
      ],
      related: [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/requests', label: 'My Requests' },
      ],
    },
  },
  {
    pattern: /^\/requests$/,
    guide: {
      id: 'requests',
      title: 'Requests Guide',
      audience: 'Employees',
      summary: 'Use this page to submit payroll-affecting requests such as overtime, reimbursements, or other supported compensation items.',
      steps: [
        'Create a new request and choose the correct request type first.',
        'Enter the amount, hours, multiplier, and reason with enough detail for approvers to understand the claim.',
        'Track the status badge until the request is approved or rejected.',
      ],
      checks: [
        'The request type matches what you are asking payroll to process.',
        'Amounts and dates are accurate before submission.',
      ],
      tips: [
        'Approved requests can feed payroll. Pending requests may miss a run if they are not cleared in time.',
      ],
      related: [
        { href: '/payslips', label: 'My Payslips' },
      ],
    },
  },
  {
    pattern: /^\/team$/,
    guide: {
      id: 'team-redirect',
      title: 'Team Workspace Guide',
      audience: 'Employees and HR admins',
      summary: 'This page now redirects you into the current payroll workspace that replaces the older team view.',
      steps: [
        'Let the redirect finish automatically.',
        'HR admins will be taken to Employee Management.',
        'Regular employees will be taken to My Requests.',
      ],
      checks: [
        'You land in the page that matches your role.',
      ],
      related: [
        { href: '/admin/employees', label: 'Employee Management' },
        { href: '/requests', label: 'My Requests' },
      ],
    },
  },
];

const defaultGuide: PageGuideDefinition = {
  id: 'generic',
  title: 'Payroll Guide',
  audience: 'Payroll users',
  summary: 'Use the navigation, review the page goal, and complete the main action before leaving the page.',
  steps: [
    'Confirm you are in the correct organization and workspace.',
    'Complete the main action on the page.',
    'Save, approve, or export only after the data looks right.',
  ],
  checks: [
    'The page reflects the organization and period you intended to work on.',
  ],
};

export function resolvePageGuide(pathname: string): PageGuideDefinition {
  const normalizedPath = String(pathname || '/').trim() || '/';
  const match = guides.find((entry) => entry.pattern.test(normalizedPath));
  return match?.guide || defaultGuide;
}

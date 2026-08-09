import {
  ArrowDown,
  ArrowRight,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarCheck2,
  Check,
  CheckCircle2,
  CircleUserRound,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  Goal,
  GraduationCap,
  MessageSquareText,
  Network,
  NotebookTabs,
  ReceiptText,
  ScanSearch,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProductPageData, ProductVisualKind } from '@/app/products/product-data'
import styles from './ProductVisual.module.css'

function FlowArrow() {
  return <ArrowRight className={styles.flowArrow} aria-hidden="true" size={18} />
}

function RecruiterVisual() {
  return (
    <div className={styles.pipeline}>
      <div className={styles.pipelineRole}>
        <BriefcaseBusiness aria-hidden="true" size={20} />
        <div><strong>Open role</strong><span>Requirements recorded</span></div>
      </div>
      <FlowArrow />
      <div className={styles.pipelineStack}>
        <span><FileText aria-hidden="true" size={16} /> Candidate record</span>
        <span><ScanSearch aria-hidden="true" size={16} /> CV review</span>
        <span><MessageSquareText aria-hidden="true" size={16} /> Interview feedback</span>
      </div>
      <FlowArrow />
      <div className={styles.pipelineDecision}>
        <ClipboardCheck aria-hidden="true" size={20} />
        <div><strong>Decision</strong><span>Reviewer-owned</span></div>
      </div>
    </div>
  )
}

function CoreHrVisual() {
  return (
    <div className={styles.orgFlow}>
      <div className={styles.personNode}>
        <CircleUserRound aria-hidden="true" size={28} />
        <strong>New member</strong>
      </div>
      <ArrowDown aria-hidden="true" size={18} />
      <div className={styles.orgRow}>
        <span><UsersRound aria-hidden="true" size={18} /> Team & role</span>
        <span><NotebookTabs aria-hidden="true" size={18} /> Transition work</span>
      </div>
      <ArrowDown aria-hidden="true" size={18} />
      <div className={styles.workspaceStrip}>
        <span>Recruiter</span><span>Leave</span><span>Time</span><span>Performance</span>
      </div>
    </div>
  )
}

function LeaveVisual() {
  return (
    <div className={styles.leaveVisual}>
      <div className={styles.calendar}>
        <div className={styles.calendarHeader}><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span></div>
        <div className={styles.calendarDays}>
          <span>14</span><span>15</span><span className={styles.calendarSelected}>16</span><span className={styles.calendarSelected}>17</span><span>18</span>
        </div>
      </div>
      <div className={styles.requestReview}>
        <div><CalendarCheck2 aria-hidden="true" size={20} /><strong>Annual leave</strong></div>
        <dl><div><dt>Balance</dt><dd>Checked</dd></div><div><dt>Policy</dt><dd>Checked</dd></div><div><dt>Owner</dt><dd>Line manager</dd></div></dl>
        <span className={styles.reviewState}><Check aria-hidden="true" size={15} /> Ready for decision</span>
      </div>
    </div>
  )
}

function PerformanceVisual() {
  const stages = [
    [Goal, 'Goals'],
    [MessageSquareText, 'Check-ins'],
    [FileCheck2, 'Appraisal'],
    [UsersRound, 'Calibration'],
  ] as const

  return (
    <div className={styles.performanceCycle}>
      {stages.map(([Icon, label], index) => (
        <div className={styles.performanceStage} key={label}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <Icon aria-hidden="true" size={19} />
          <strong>{label}</strong>
          {index < stages.length - 1 ? <ArrowRight aria-hidden="true" size={17} /> : null}
        </div>
      ))}
    </div>
  )
}

function TimeVisual() {
  const entries = [
    ['08:58', 'Clock in', 'Workplace location checked'],
    ['12:31', 'Break start', 'Recorded'],
    ['13:14', 'Break end', 'Recorded'],
    ['17:42', 'Clock out', 'Timesheet updated'],
  ]

  return (
    <div className={styles.timeLedger}>
      <div className={styles.timeHeader}><Clock3 aria-hidden="true" size={20} /><strong>Tuesday time record</strong><span>Draft</span></div>
      <ol>
        {entries.map(([time, action, state]) => (
          <li key={action}><time>{time}</time><span><strong>{action}</strong><small>{state}</small></span><CheckCircle2 aria-hidden="true" size={17} /></li>
        ))}
      </ol>
      <div className={styles.ruleLine}><ShieldCheck aria-hidden="true" size={17} /> Effective rule pack preserved with the timesheet</div>
    </div>
  )
}

function PayrollVisual() {
  return (
    <div className={styles.payrollRun}>
      <div className={styles.payrollHeader}><WalletCards aria-hidden="true" size={20} /><div><strong>Payroll run</strong><span>Review before release</span></div><span className={styles.pendingState}>Pending review</span></div>
      <div className={styles.payrollInputs}>
        <span><CircleUserRound aria-hidden="true" size={17} /> Employee setup</span>
        <span><Clock3 aria-hidden="true" size={17} /> Approved time</span>
        <span><ReceiptText aria-hidden="true" size={17} /> Adjustments</span>
      </div>
      <div className={styles.payrollChecks}>
        <div><span>Readiness gates</span><strong>Inspect before approval</strong></div>
        <div><span>Jurisdiction pack</span><strong>Must be enabled and reviewed</strong></div>
        <div><span>Output</span><strong>Payslips, reports and exports</strong></div>
      </div>
    </div>
  )
}

function ExperienceVisual() {
  const stages = [
    [FileText, 'Survey'],
    [Network, 'Collectors'],
    [ScanSearch, 'Analysis'],
    [ClipboardCheck, 'Follow-up'],
  ] as const

  return (
    <div className={styles.experienceFlow}>
      {stages.map(([Icon, title], index) => (
        <div className={styles.experienceStep} key={title}>
          <span>{String(index + 1).padStart(2, '0')}</span><Icon aria-hidden="true" size={22} /><strong>{title}</strong>
          {index < stages.length - 1 ? <FlowArrow /> : null}
        </div>
      ))}
      <div className={styles.evidenceLine}><ShieldCheck aria-hidden="true" size={17} /> Source evidence stays attached to the analysis.</div>
    </div>
  )
}

function LearningVisual() {
  return (
    <div className={styles.courseOutline}>
      <div className={styles.courseHeader}><GraduationCap aria-hidden="true" size={22} /><div><strong>Manager foundations</strong><span>Structured course</span></div></div>
      <ol>
        <li><span>01</span><div><strong>Working with a team</strong><small>3 lessons</small></div><Check aria-hidden="true" size={17} /></li>
        <li><span>02</span><div><strong>Useful one-to-ones</strong><small>2 lessons + live class</small></div><BookOpenCheck aria-hidden="true" size={17} /></li>
        <li><span>03</span><div><strong>Assessment</strong><small>Quiz and assignment</small></div><ClipboardCheck aria-hidden="true" size={17} /></li>
      </ol>
    </div>
  )
}

const visuals: Record<ProductVisualKind, () => ReactNode> = {
  recruiter: RecruiterVisual,
  'core-hr': CoreHrVisual,
  leave: LeaveVisual,
  performance: PerformanceVisual,
  time: TimeVisual,
  payroll: PayrollVisual,
  experience: ExperienceVisual,
  learning: LearningVisual,
}

export default function ProductVisual({ product }: { product: ProductPageData }) {
  const Visual = visuals[product.visual]

  return (
    <figure className={styles.visual} role="img" aria-label={product.visualLabel}>
      <figcaption><span>{product.name}</span><strong>Conceptual workflow</strong></figcaption>
      <div className={styles.visualBody}><Visual /></div>
    </figure>
  )
}

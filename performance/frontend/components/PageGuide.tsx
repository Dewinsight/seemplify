'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography
} from '@mui/material';
import {
  CheckCircleOutline,
  Close,
  HelpOutline,
  LightbulbOutlined,
  MenuBookOutlined,
  OpenInNew
} from '@mui/icons-material';

type GuideDefinition = {
  key: string;
  matcher: RegExp;
  title: string;
  summary: string;
  purpose: string;
  steps: string[];
  success: string[];
  tips?: string[];
};

const FALLBACK_GUIDE: Omit<GuideDefinition, 'matcher'> = {
  key: 'generic',
  title: 'Page Guide',
  summary: 'Use this page to complete the next task in your performance workflow.',
  purpose: 'Each page in Performance Management is designed around one job. Read the heading, review the status cues, then complete the primary action on the page.',
  steps: [
    'Start with the page title and any status banners or summary cards at the top.',
    'Complete the main form, checklist, or action that this page is asking for.',
    'Save or submit when the page confirms that your information is complete.'
  ],
  success: [
    'The page shows a saved, submitted, or completed state.',
    'The next person in the workflow can continue without manual follow-up.'
  ],
  tips: [
    'Use the dashboard and top navigation to return to the next priority item.',
    'If you are unsure what a field means, open the full tutorial for role-based walkthroughs.'
  ]
};

const PAGE_GUIDES: GuideDefinition[] = [
  {
    key: 'login',
    matcher: /^\/login$/,
    title: 'Sign In',
    summary: 'Use this page to enter the performance system through the identity provider.',
    purpose: 'This is the entry point into Performance Management. Once authentication succeeds, the app sends you to your dashboard and loads your organization, role, and current team.',
    steps: [
      'Select the sign-in action and complete authentication with the identity provider.',
      'Wait for the redirect back into Performance Management.',
      'After login, confirm that the dashboard shows the correct organization and team.'
    ],
    success: [
      'You land on the dashboard without an auth error.',
      'Your role-aware navigation is visible at the top of the app.'
    ],
    tips: [
      'If you belong to multiple organizations, switch to the correct one from the top bar after login.'
    ]
  },
  {
    key: 'dashboard',
    matcher: /^\/dashboard$/,
    title: 'Dashboard',
    summary: 'Use the dashboard to see what needs attention now and jump directly into the right workflow.',
    purpose: 'The dashboard is your starting point. It highlights progress, pending work, manager notifications, and quick actions based on your role.',
    steps: [
      'Read the top cards to see current OKR, appraisal, and team status.',
      'If a notification strip is showing, act on it first because it represents a live workflow handoff.',
      'Use the quick actions or team selector to move into the page where the real work happens.'
    ],
    success: [
      'You can identify your next action in under a minute.',
      'You move into the right page without guessing where a task lives.'
    ],
    tips: [
      'Managers should watch the review notification strip.',
      'HR and admins should use the dashboard shortcuts to create or manage cycles quickly.'
    ]
  },
  {
    key: 'okrs',
    matcher: /^\/okrs$/,
    title: 'My OKRs',
    summary: 'Create, update, and monitor your objectives and key results here.',
    purpose: 'This page keeps your goals current. It is where you define what success looks like for the period and update progress as work moves forward.',
    steps: [
      'Review active OKRs and check whether progress is still accurate.',
      'Create or edit objectives so each one has clear, measurable key results.',
      'Update progress regularly so appraisals and manager reviews reflect current performance.'
    ],
    success: [
      'Your active OKRs reflect current work and measurable outcomes.',
      'Progress data is current enough for reviews and 1:1 discussions.'
    ],
    tips: [
      'Keep objectives outcome-focused, not task-focused.',
      'Use alignment when you need to connect your OKRs to a higher-level goal.'
    ]
  },
  {
    key: 'support-plans',
    matcher: /^\/support-plans$/,
    title: 'Support Plans',
    summary: 'Use this page to create, review, acknowledge, and track a fair support plan.',
    purpose: 'Support plans make expectations and the help provided by the organization explicit. Managers draft, HR reviews, employees respond, and both sides record progress.',
    steps: [
      'Open the plan that is waiting for your role or create a draft for an authorized direct report.',
      'Review measurable objectives, review dates, and organization support commitments.',
      'Complete the action shown for your role and use check-ins while the plan is active.'
    ],
    success: ['Every participant can see the current state and next action.', 'The plan has a complete, auditable decision and progress history.'],
    tips: ['Support plans do not calculate appraisal ratings.', 'AI drafting is optional and every suggestion requires human review.']
  },
  {
    key: 'recognition',
    matcher: /^\/recognition$/,
    title: 'Recognition',
    summary: 'Thank a colleague for a specific contribution and choose the right audience.',
    purpose: 'Recognition reinforces valued contributions without turning appreciation into a performance score.',
    steps: ['Search for a colleague in your active organization.', 'Describe the contribution and its impact.', 'Choose organization, team, or private visibility before sending.'],
    success: ['The recipient receives recognition through the secure action centre.', 'The message is visible only to the selected audience.']
  },
  {
    key: 'project-feedback',
    matcher: /^\/project-feedback$/,
    title: 'Project Feedback',
    summary: 'Create a project membership record and request feedback between project participants.',
    purpose: 'This page gives project leads a governed way to request feedback from people who worked together, including cross-functional work.',
    steps: ['Open or create the project and confirm its participants.', 'Choose the project member receiving feedback and a different member as reviewer.', 'Set a due date and send the request.'],
    success: ['Only a project lead can create a request.', 'Both subject and reviewer are verified project members.']
  },
  {
    key: 'coaching',
    matcher: /^\/coaching$/,
    title: 'Manager Coaching',
    summary: 'Use this queue to keep manager follow-ups consistent across the team.',
    purpose: 'The coaching workspace highlights missed practices and open workflow items without scoring or ranking employees.',
    steps: ['Filter by employee or priority.', 'Open the underlying goal, check-in, 1:1, feedback, or support-plan record.', 'Complete the work in its source page, then refresh the queue.'],
    success: ['Manager-owned follow-ups are visible in one place.', 'Coverage definitions explain exactly how each signal is calculated.']
  },
  {
    key: 'okr-alignment',
    matcher: /^\/okrs\/alignment$/,
    title: 'OKR Alignment',
    summary: 'Use this page to connect your goals to team or organization priorities.',
    purpose: 'Alignment shows how individual objectives support broader business goals. It makes reviews and progress discussions easier to justify.',
    steps: [
      'Choose the objective you want to align.',
      'Select the parent or higher-level OKR it supports.',
      'Confirm the relationship is clear before saving.'
    ],
    success: [
      'Your OKR clearly rolls up into a team or company objective.',
      'Managers can trace your work to a larger outcome.'
    ]
  },
  {
    key: 'appraisals',
    matcher: /^\/appraisals$/,
    title: 'Appraisals',
    summary: 'This page shows your appraisal work items and their current stage.',
    purpose: 'Use this page to find active appraisals, see what stage each one is in, and open the exact workflow step waiting on you.',
    steps: [
      'Review the status of each appraisal and identify which one needs action now.',
      'Open the appraisal that is pending on you.',
      'Complete the assigned stage instead of trying to do everything from the list view.'
    ],
    success: [
      'You know which appraisal is waiting on you.',
      'You open the right stage and finish the required submission.'
    ],
    tips: [
      'Employees usually start with self-assessment.',
      'Managers only move when employee submissions are ready for review.'
    ]
  },
  {
    key: 'appraisal-detail',
    matcher: /^\/appraisals\/[^/]+$/,
    title: 'Appraisal Overview',
    summary: 'Use the appraisal overview as the control panel for one appraisal record.',
    purpose: 'This page shows the full context for a single appraisal, including stage, status, and where to go next in the workflow.',
    steps: [
      'Check the current status and phase indicators first.',
      'Open the next stage page from here instead of guessing the sequence.',
      'Return to this overview whenever you need the full record context.'
    ],
    success: [
      'You understand the current appraisal stage.',
      'You can move into the correct task page from one place.'
    ]
  },
  {
    key: 'self-assessment',
    matcher: /^\/appraisals\/[^/]+\/self-assessment$/,
    title: 'Self-Assessment',
    summary: 'This is where the employee completes their side of the appraisal.',
    purpose: 'Use this page to reflect on achievements, challenges, learning, and goals. If AI assist is enabled, it should help you structure the assessment without replacing your judgment.',
    steps: [
      'Review your OKRs, feedback, and recent work before writing.',
      'Complete each self-assessment section with specific examples and measurable outcomes.',
      'Save as needed, then submit only when the assessment is complete.'
    ],
    success: [
      'Your submission clearly explains what you achieved and what needs development.',
      'The manager review can start without extra clarification.'
    ],
    tips: [
      'Use concrete outcomes, not generic statements.',
      'Submission should be the handoff that starts the manager workflow.'
    ]
  },
  {
    key: 'manager-review',
    matcher: /^\/appraisals\/[^/]+\/manager-review$/,
    title: 'Manager Review',
    summary: 'Use this page to assess the employee after the self-assessment is submitted.',
    purpose: 'This is the manager decision point. Review the employee input, validate OKR delivery, rate competencies, and submit a clear, defensible evaluation.',
    steps: [
      'Read the employee self-assessment before scoring anything.',
      'Assess competencies and OKR delivery with evidence-backed comments.',
      'Save progress if needed, then submit when the review is ready for the next stage.'
    ],
    success: [
      'The review is complete, evidence-based, and successfully submitted.',
      'The appraisal moves forward without manual cleanup or retries.'
    ],
    tips: [
      'If AI bias checks are enabled, use them to challenge weak assumptions before submitting.'
    ]
  },
  {
    key: 'final-review',
    matcher: /^\/appraisals\/[^/]+\/final-review$/,
    title: 'Final Review',
    summary: 'Use this page to confirm the final outcome of the appraisal.',
    purpose: 'This stage brings the review to closure. It is where final comments, ratings, and sign-off decisions are confirmed.',
    steps: [
      'Review the full appraisal history and any calibration outcome first.',
      'Confirm the final narrative and rating decisions.',
      'Complete the final submission or sign-off action.'
    ],
    success: [
      'The appraisal is in a finalized state.',
      'The employee can see the final outcome and acknowledge it if required.'
    ]
  },
  {
    key: 'discussion',
    matcher: /^\/appraisals\/[^/]+\/discussion$/,
    title: 'Discussion',
    summary: 'Use this page to capture the appraisal conversation between manager and employee.',
    purpose: 'The discussion stage closes the loop. It documents the conversation around results, expectations, and next steps.',
    steps: [
      'Review the completed appraisal before the meeting starts.',
      'Use the page to record discussion outcomes, agreements, or follow-up items.',
      'Finish the discussion workflow so the appraisal can move to completion.'
    ],
    success: [
      'Both sides have a shared record of the conversation.',
      'Follow-up actions are explicit, not implied.'
    ]
  },
  {
    key: 'goal-setting',
    matcher: /^\/appraisals\/[^/]+\/goal-setting$/,
    title: 'Appraisal Goals',
    summary: 'Review the locked goal evidence captured automatically for this appraisal.',
    purpose: 'This page explains which approved individual goals were captured at the appraisal cutoff. It is read-only so later goal changes cannot rewrite historical performance evidence.',
    steps: [
      'Review the captured goals, versions, and cutoff achievement.',
      'Use the Goals workspace only when you need to manage the live goal outside this appraisal.',
      'Continue to self-assessment when you are ready; there is nothing to save on this page.'
    ],
    success: [
      'You understand the goal evidence that will support this review.',
      'The appraisal remains based on an immutable historical snapshot.'
    ]
  },
  {
    key: 'calibration-stage',
    matcher: /^\/appraisals\/[^/]+\/calibration$/,
    title: 'Calibration',
    summary: 'Use this page to review rating consistency and fairness before finalization.',
    purpose: 'Calibration is the quality-control stage for appraisal outcomes. It is where leadership or HR checks for inconsistent rating standards across people or teams.',
    steps: [
      'Review the submitted manager evaluation and supporting evidence.',
      'Compare the outcome with the broader rating context if available.',
      'Confirm or adjust the result with clear justification.'
    ],
    success: [
      'The rating is fair, documented, and ready for final review.'
    ]
  },
  {
    key: 'team',
    matcher: /^\/team$/,
    title: 'My Team',
    summary: 'Use this page as the manager home for direct-report visibility and action.',
    purpose: 'This page gives managers a quick picture of who is on the team and where attention is needed across reviews, OKRs, and feedback.',
    steps: [
      'Scan the team list and summary information first.',
      'Open a team member when you need detailed context.',
      'Move into team appraisals, OKRs, feedback, or reviews depending on the task.'
    ],
    success: [
      'You can see who needs support or action quickly.',
      'You can navigate to the right team workflow without hunting.'
    ]
  },
  {
    key: 'team-member',
    matcher: /^\/team\/(?!appraisals$|okrs$|feedback$|reviews$)[^/]+$/,
    title: 'Team Member Profile',
    summary: 'Use this page to review one direct report in detail.',
    purpose: 'This page is the manager detailed view of one employee across performance signals.',
    steps: [
      'Review the employee summary and current status indicators.',
      'Check their goals, review status, and supporting context.',
      'Use the linked workflows to take the next manager action.'
    ],
    success: [
      'You have enough context to coach, review, or follow up effectively.'
    ]
  },
  {
    key: 'team-appraisals',
    matcher: /^\/team\/appraisals$/,
    title: 'Team Appraisals',
    summary: 'Use this page to track appraisal progress across your direct reports.',
    purpose: 'This is the team-level queue for managers. It shows which appraisals are waiting on employees, waiting on you, or already moving forward.',
    steps: [
      'Review the team appraisal statuses to find blockers.',
      'Open any appraisal that is waiting on your manager action.',
      'Use statuses to follow up with employees whose submissions are late.'
    ],
    success: [
      'No manager-owned appraisal is sitting untouched.',
      'You know where the team is blocked.'
    ]
  },
  {
    key: 'team-okrs',
    matcher: /^\/team\/okrs$/,
    title: 'Team OKRs',
    summary: 'Use this page to monitor team goal progress and coaching needs.',
    purpose: 'This page helps managers spot stalled goals, misalignment, or people who need support on execution.',
    steps: [
      'Review progress across direct reports.',
      'Open individual team members when an OKR needs deeper discussion.',
      'Use this view to prepare for 1:1s and review conversations.'
    ],
    success: [
      'You can explain team progress and who needs support.'
    ]
  },
  {
    key: 'team-feedback',
    matcher: /^\/team\/feedback$/,
    title: 'Team Feedback',
    summary: 'Use this page to review and manage feedback activity across your team.',
    purpose: 'Feedback should be continuous, not only tied to appraisal season. This page helps managers check whether team members are getting useful input.',
    steps: [
      'Review recent feedback activity for patterns or gaps.',
      'Open or create feedback where a team member needs direction.',
      'Use feedback data to prepare for reviews or coaching sessions.'
    ],
    success: [
      'Team members have current, usable feedback in the system.'
    ]
  },
  {
    key: 'team-reviews',
    matcher: /^\/team\/reviews$/,
    title: 'Team Reviews',
    summary: 'Use this page to track review work across the team.',
    purpose: 'This page surfaces review records and pending manager activity for direct reports.',
    steps: [
      'Check which team reviews are active or pending.',
      'Open the specific review that requires action.',
      'Complete the review or follow up on missing employee inputs.'
    ],
    success: [
      'Review work is progressing and no direct report is lost in the flow.'
    ]
  },
  {
    key: 'feedback',
    matcher: /^\/feedback$/,
    title: 'Feedback',
    summary: 'Use this page to request, give, and review feedback.',
    purpose: 'Feedback supports development between formal appraisal stages. This page keeps the feedback loop active and visible.',
    steps: [
      'Review incoming and outgoing feedback first.',
      'Request feedback when you need perspective on specific work.',
      'Give timely, specific feedback instead of waiting for the next cycle.'
    ],
    success: [
      'Feedback is current, specific, and useful for growth and reviews.'
    ]
  },
  {
    key: 'one-on-ones',
    matcher: /^\/one-on-ones$/,
    title: '1:1 Meetings',
    summary: 'Use this page to plan, review, and follow up on 1:1 conversations.',
    purpose: '1:1s turn performance data into coaching. This page helps track meeting cadence, conversation quality, and follow-up items.',
    steps: [
      'Review upcoming or recent 1:1s.',
      'Prepare talking points before the meeting.',
      'Capture decisions or follow-up actions after the discussion.'
    ],
    success: [
      'Meetings produce clear next steps instead of informal memory only.'
    ]
  },
  {
    key: 'development',
    matcher: /^\/development$/,
    title: 'Development',
    summary: 'Use this page to track growth plans, capability gaps, and follow-up actions.',
    purpose: 'Development turns review output into improvement work. This page should connect feedback and appraisal outcomes to concrete growth actions.',
    steps: [
      'Review the development items already in progress.',
      'Add or update actions tied to current feedback or review outcomes.',
      'Track completion and revisit plans during 1:1s.'
    ],
    success: [
      'Development needs are translated into concrete actions and owners.'
    ]
  },
  {
    key: 'analytics',
    matcher: /^\/analytics$/,
    title: 'Analytics',
    summary: 'Use this page to understand performance patterns and trends.',
    purpose: 'Analytics gives you the high-level picture behind day-to-day activity. Use it for trends, exceptions, and decision support, not for transaction work.',
    steps: [
      'Start with the headline metrics and trend charts.',
      'Look for bottlenecks, overdue items, or unusual rating patterns.',
      'Move into the relevant workflow page when the data points to action.'
    ],
    success: [
      'You can identify the most important performance risks or trends quickly.'
    ]
  },
  {
    key: 'reviews',
    matcher: /^\/reviews$/,
    title: 'Reviews',
    summary: 'Use this page to manage the review records available to you.',
    purpose: 'This page lists review activity outside the appraisal queue so you can open, track, or complete the relevant review item.',
    steps: [
      'Review the status of each review item.',
      'Open the record that needs action or inspection.',
      'Complete the review or use it as supporting context for other workflows.'
    ],
    success: [
      'Review records are easy to find and act on.'
    ]
  },
  {
    key: 'review-detail',
    matcher: /^\/reviews\/[^/]+$/,
    title: 'Review Detail',
    summary: 'Use this page to inspect or complete one review in detail.',
    purpose: 'This is the detailed record for a single review item, including its content, status, and next action.',
    steps: [
      'Review the full record before changing anything.',
      'Update or complete the review content as required.',
      'Save or submit so the record reflects the latest state.'
    ],
    success: [
      'The review is accurate, complete, and ready for the next person.'
    ]
  },
  {
    key: 'admin-home',
    matcher: /^\/admin$/,
    title: 'Admin Panel',
    summary: 'Use the admin panel to manage cycles and monitor organization-level performance workflows.',
    purpose: 'This is the control center for HR and admins. It brings cycle management, reporting, and calibration access together with organization-wide analytics.',
    steps: [
      'Start with the summary metrics to understand cycle health.',
      'Use the action buttons to create a cycle, manage existing cycles, or open reports.',
      'Drill into a department or workflow when the metrics show an issue.'
    ],
    success: [
      'You can move from analytics to the exact admin workflow that needs action.'
    ]
  },
  {
    key: 'admin-appraisal-cycles',
    matcher: /^\/admin\/appraisal-cycles$/,
    title: 'Appraisal Cycle Management',
    summary: 'Use this page to create, inspect, and monitor appraisal cycles.',
    purpose: 'This page is the home for appraisal cycle operations. New cycles should now be created and launched in one flow, while older draft cycles can still be completed if needed.',
    steps: [
      'Review active cycles first to understand current load and bottlenecks.',
      'Use Create And Launch Cycle for new work instead of relying on a draft-first process.',
      'Open a cycle to inspect health or finish setup on any legacy draft still in the system.'
    ],
    success: [
      'New cycles start active with participants already attached.',
      'Legacy drafts are the exception, not the normal path.'
    ]
  },
  {
    key: 'admin-cycle-create',
    matcher: /^\/admin\/appraisal-cycles\/new$/,
    title: 'Create Review Cycle',
    summary: 'Set the review period, customize the review design, choose employees, and confirm the launch in four steps.',
    purpose: 'This flow starts a review without exposing internal workflow configuration. Targets are maintained before the review; employees then complete an AI-guided reflection before the line-manager review and discussion.',
    steps: [
      'Name the cycle and choose the performance period it covers.',
      'Choose employees who have an assigned line manager.',
      'Review the people and settings, then launch the cycle.'
    ],
    success: [
      'Every selected employee receives a self-assessment work item.',
      'Line managers join after their employees submit.'
    ]
  },
  {
    key: 'admin-cycle-detail',
    matcher: /^\/admin\/appraisal-cycles\/[^/]+$/,
    title: 'Cycle Detail',
    summary: 'Use this page to inspect one appraisal cycle and its current progress.',
    purpose: 'This page shows the operational health of a single cycle, including phase timing, status, and completion metrics.',
    steps: [
      'Review the overview and statistics first.',
      'Check the current phase and timeline to understand what should be happening now.',
      'Open edit only when a configuration change is actually required.'
    ],
    success: [
      'You can explain the current state of the cycle and what needs attention.'
    ]
  },
  {
    key: 'admin-cycle-edit',
    matcher: /^\/admin\/appraisal-cycles\/[^/]+\/edit$/,
    title: 'Create Or Edit Cycle',
    summary: 'Use this page to define a cycle and, for new cycles, launch it immediately with selected participants.',
    purpose: 'This page is where the new end-to-end cycle flow lives. For new cycles, define the setup, choose eligible participants, and create the cycle once so it becomes active immediately.',
    steps: [
      'Review the basic cycle details and phase dates.',
      'If this is a new cycle, choose the participants who should be included right here.',
      'Create and launch once; editing an existing cycle should only be used for configuration updates.'
    ],
    success: [
      'A new cycle is active immediately after creation.',
      'Participants are attached up front instead of through a second hidden step.'
    ],
    tips: [
      'Only employees with a real manager in the hierarchy should be selectable for appraisal.'
    ]
  },
  {
    key: 'admin-review-cycles',
    matcher: /^\/admin\/review-cycles$/,
    title: 'Review Cycles',
    summary: 'Use this page to manage review-cycle configuration outside the appraisal cycle flow.',
    purpose: 'This page governs review cycle timing and activation for the review module.',
    steps: [
      'Review the current cycle list and status.',
      'Create or activate a cycle when a new review period needs to begin.',
      'Use this page for review-cycle administration, not appraisal participant launch.'
    ],
    success: [
      'The correct review cycle is active for the intended audience.'
    ]
  },
  {
    key: 'admin-calibration',
    matcher: /^\/admin\/calibration$/,
    title: 'Calibration Center',
    summary: 'Use this page to review rating fairness and consistency across the organization.',
    purpose: 'Calibration helps HR and leadership keep standards consistent. This page should be used after manager reviews are submitted and before final outcomes are confirmed.',
    steps: [
      'Review the rating distribution and flagged outliers first.',
      'Open the appraisals or groups that need closer inspection.',
      'Apply only justified changes and keep the rationale clear.'
    ],
    success: [
      'Final ratings are consistent and defensible across teams.'
    ]
  },
  {
    key: 'admin-reports',
    matcher: /^\/admin\/reports$/,
    title: 'Reports',
    summary: 'Use this page to analyze and export organization-level performance information.',
    purpose: 'Reports turn workflow data into decision support for HR and leadership.',
    steps: [
      'Start with the report or filter most relevant to the decision you need to make.',
      'Review the trend or breakdown carefully before exporting.',
      'Use exported reports for communication, governance, or leadership review.'
    ],
    success: [
      'You leave with a report that answers a real management question.'
    ]
  },
  {
    key: 'admin-department',
    matcher: /^\/admin\/departments\/[^/]+$/,
    title: 'Department Drill-Down',
    summary: 'Use this page to inspect performance data for one department.',
    purpose: 'This page helps HR and admins understand how one department is performing relative to the wider organization.',
    steps: [
      'Review the department-level metrics and distributions.',
      'Look for teams, stages, or managers driving the pattern.',
      'Use the findings to target follow-up actions in the right workflow.'
    ],
    success: [
      'You can explain what is happening in that department with evidence.'
    ]
  },
  {
    key: 'tutorial',
    matcher: /^\/tutorial$/,
    title: 'Full Tutorial',
    summary: 'Use this page for the long-form walkthrough of the platform by role.',
    purpose: 'This page is the deeper training view. The page guide gives page-specific help, while the tutorial explains the end-to-end system by role.',
    steps: [
      'Choose the role section that matches the work you are doing.',
      'Read the workflow steps in order so the full process is clear.',
      'Return to the live page you are working on and use the page guide there for local instructions.'
    ],
    success: [
      'You understand both the full workflow and the current page task.'
    ]
  }
];

function resolveGuide(pathname: string) {
  const match = PAGE_GUIDES.find((guide) => guide.matcher.test(pathname));
  if (match) return match;

  return {
    ...FALLBACK_GUIDE,
    matcher: /.*/,
  };
}

export default function PageGuide({ pathnameOverride, showBanner = true }: { pathnameOverride?: string; showBanner?: boolean }) {
  const livePathname = usePathname();
  const pathname = pathnameOverride || livePathname || '';
  const guide = useMemo(() => resolveGuide(pathname), [pathname]);

  const [drawerState, setDrawerState] = useState({ guideKey: '', open: false });
  const [dismissedGuideKey, setDismissedGuideKey] = useState<string | null>(null);
  const drawerOpen = drawerState.guideKey === guide.key && drawerState.open;
  const bannerVisible = showBanner && dismissedGuideKey !== guide.key;
  const openDrawer = () => setDrawerState({ guideKey: guide.key, open: true });
  const closeDrawer = () => setDrawerState({ guideKey: guide.key, open: false });

  return (
    <>
      {showBanner && bannerVisible && (
        <Paper
          data-testid="page-guide-banner"
          elevation={0}
          sx={{
            display: { xs: 'none', sm: 'block' },
            mb: 2,
            px: 1.5,
            py: 1,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper'
          }}
        >
          <Stack direction="row" spacing={1.5} justifyContent="space-between" alignItems="center" sx={{ minHeight: 38 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              <HelpOutline color="primary" sx={{ fontSize: 19, flexShrink: 0 }} />
              <Typography variant="body2" fontWeight={700} whiteSpace="nowrap">
                {guide.title} guide
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                noWrap
                sx={{ display: { sm: 'none', md: 'block' }, minWidth: 0 }}
              >
                {guide.summary}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
              <Button size="small" variant="contained" onClick={openDrawer}>
                Open guide
              </Button>
              <Button component={Link} href="/tutorial" size="small" variant="text" startIcon={<MenuBookOutlined />}>
                Tutorial
              </Button>
              <IconButton size="small" onClick={() => setDismissedGuideKey(guide.key)} aria-label="Hide page guide banner">
                <Close fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
        </Paper>
      )}

      <Button
        variant="contained"
        color="info"
        startIcon={<HelpOutline />}
        onClick={openDrawer}
        sx={{
          display: { xs: 'inline-flex', sm: showBanner && bannerVisible ? 'none' : 'inline-flex' },
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: 1200,
          borderRadius: 2,
          px: 2,
          boxShadow: 2
        }}
      >
        Guide
      </Button>

      <Drawer anchor="right" open={drawerOpen} onClose={closeDrawer}>
        <Box sx={{ width: { xs: '100vw', sm: 420 }, maxWidth: '100vw', p: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Box>
              <Typography variant="body2" color="text.secondary">Page guide</Typography>
              <Typography variant="h5" fontWeight={700}>{guide.title}</Typography>
            </Box>
            <IconButton onClick={closeDrawer} aria-label="Close guide">
              <Close />
            </IconButton>
          </Stack>

          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            {guide.summary}
          </Typography>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              What This Page Is For
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {guide.purpose}
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              How To Use It
            </Typography>
            <List dense disablePadding>
              {guide.steps.map((step, index) => (
                <ListItem key={`${guide.key}-step-${index}`} disableGutters sx={{ alignItems: 'flex-start', py: 0.75 }}>
                  <ListItemIcon sx={{ minWidth: 32, mt: 0.25 }}>
                    <Chip size="small" label={index + 1} color="primary" />
                  </ListItemIcon>
                  <ListItemText primary={step} />
                </ListItem>
              ))}
            </List>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              What Success Looks Like
            </Typography>
            <List dense disablePadding>
              {guide.success.map((item, index) => (
                <ListItem key={`${guide.key}-success-${index}`} disableGutters sx={{ py: 0.5 }}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <CheckCircleOutline color="success" fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={item} />
                </ListItem>
              ))}
            </List>
          </Paper>
          {guide.tips && guide.tips.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Practical Tips
              </Typography>
              <List dense disablePadding>
                {guide.tips.map((tip, index) => (
                  <ListItem key={`${guide.key}-tip-${index}`} disableGutters sx={{ py: 0.5 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <LightbulbOutlined color="warning" fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={tip} />
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}

          <Divider sx={{ my: 2 }} />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button component={Link} href="/tutorial" variant="contained" startIcon={<MenuBookOutlined />} fullWidth>
              Open Full Tutorial
            </Button>
            <Button component={Link} href="/dashboard" variant="outlined" endIcon={<OpenInNew />} fullWidth>
              Go To Dashboard
            </Button>
          </Stack>
        </Box>
      </Drawer>
    </>
  );
}

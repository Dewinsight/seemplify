'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserContext } from '@/lib/hooks';
import {
  Box, Typography, Card, CardContent, Grid, Button, Paper,
  Stepper, Step, StepLabel, Accordion, AccordionSummary,
  AccordionDetails, Avatar, List, ListItem, ListItemIcon,
  ListItemText, Alert, useTheme, useMediaQuery
} from '@mui/material';
import {
  Assessment, Person, Groups, Feedback, Flag,
  CheckCircle, ArrowForward, ExpandMore, Lightbulb,
  Psychology, TrendingUp, VideoCall, Chat, Description, Settings,
  Timeline, Rocket
} from '@mui/icons-material';

interface TutorialStep {
  title: string;
  description: string;
  icon: React.ReactNode;
  details: string[];
  action?: { label: string; href: string };
}

const historyStep: TutorialStep = {
  title: 'Find Historical Appraisals and Results',
  description: 'Open completed reviews and their published results',
  icon: <Description color="secondary" />,
  details: [
    'Open Appraisals, then choose History & results',
    'Search and filter the completed appraisals you are allowed to view',
    'Open View result report to read the published feedback and final rating',
    'Download the filtered history as CSV or print a result report'
  ],
  action: { label: 'History & results', href: '/appraisals?section=history' }
};

const startAppraisalStep: TutorialStep = {
  title: 'Start an Appraisal',
  description: 'Managers and HR can begin reviews for staff in their authorized scope',
  icon: <Rocket color="primary" />,
  details: [
    'Open Appraisals and choose Start appraisal',
    'Select staff and choose an eligible reviewer for each person',
    'Choose an available cycle configured by HR, or create a one-off review',
    'Check the review period, required steps and response deadlines before starting',
    'Open the launch results to see reviews that started and any people who need attention'
  ],
  action: { label: 'Start appraisal', href: '/appraisals/start' }
};

const employeeSteps: TutorialStep[] = [
  {
    title: 'Set Your OKRs',
    description: 'Define your objectives and key results for the period',
    icon: <Flag color="primary" />,
    details: [
      'Create 3-5 objectives that align with team and company goals',
      'Each objective should have 2-4 measurable key results',
      'Link your OKRs to your manager\'s or company OKRs for alignment',
      'Update progress regularly throughout the period'
    ],
    action: { label: 'Go to OKRs', href: '/okrs' }
  },
  {
    title: 'Request & Give Feedback',
    description: 'Continuous feedback helps you grow',
    icon: <Feedback color="info" />,
    details: [
      'Request feedback from peers and managers on specific projects',
      'Give constructive feedback to colleagues to help them improve',
      'Both praise and constructive feedback are valuable',
      'Feedback is used to inform your performance review'
    ],
    action: { label: 'View Feedback', href: '/feedback' }
  },
  {
    title: 'Attend 1:1 Meetings',
    description: 'Regular check-ins with your manager',
    icon: <VideoCall color="success" />,
    details: [
      'Schedule recurring 1:1s with your manager (weekly or bi-weekly)',
      'Prepare talking points and updates before each meeting',
      'Discuss progress, blockers, and development goals',
      'Record agreed notes and follow-up actions'
    ],
    action: { label: 'View 1:1s', href: '/one-on-ones' }
  },
  {
    title: 'Complete Self-Assessment',
    description: 'Reflect on your achievements during the review period',
    icon: <Assessment color="warning" />,
    details: [
      'When an appraisal cycle starts, you\'ll be notified to begin',
      'Review your OKRs, feedback, and 1:1 notes',
      'Choose Use manual form to complete the review without ChatGPT',
      'Answer the required cycle questions and attach supporting documents when required',
      'Optional AI assistance requires a connected account and data-sharing consent',
      'Be honest about challenges and areas for improvement',
      'Submit before the deadline'
    ],
    action: { label: 'View Appraisals', href: '/appraisals' }
  },
  {
    title: 'Discuss & Acknowledge',
    description: 'Review results with your manager and acknowledge',
    icon: <Chat color="secondary" />,
    details: [
      'After manager review, schedule a discussion meeting',
      'Review the ratings and feedback together',
      'Discuss development plan and next steps',
      'Acknowledge the appraisal to complete the process'
    ]
  },
  historyStep
];

const managerSteps: TutorialStep[] = [
  startAppraisalStep,
  {
    title: 'View Your Team',
    description: 'Get an overview of all your direct reports',
    icon: <Groups color="primary" />,
    details: [
      'See all team members and their current status',
      'View OKR progress, pending appraisals, and 1:1 dates',
      'Click on any team member to see their full profile',
      'Identify who needs attention or support'
    ],
    action: { label: 'Go to Team', href: '/team' }
  },
  {
    title: 'Schedule & Conduct 1:1s',
    description: 'Regular check-ins with your team members',
    icon: <VideoCall color="info" />,
    details: [
      'Schedule recurring 1:1s with each direct report',
      'Prepare the agenda and discuss progress, blockers and support',
      'Record agreed notes and follow-up actions',
      'Appraisal ratings are recorded and approved by people'
    ],
    action: { label: 'View 1:1s', href: '/one-on-ones' }
  },
  {
    title: 'Give Continuous Feedback',
    description: 'Provide timely feedback throughout the year',
    icon: <Feedback color="success" />,
    details: [
      'Give feedback after significant events or milestones',
      'Balance praise and constructive feedback',
      'Document specific examples and observations',
      'Feedback informs the appraisal process'
    ],
    action: { label: 'Give Feedback', href: '/feedback?compose=true' }
  },
  {
    title: 'Complete Manager Reviews',
    description: 'Evaluate your team during appraisal cycles',
    icon: <Assessment color="warning" />,
    details: [
      'Open Reviews I’m conducting and follow the steps configured for that cycle',
      'Review their self-assessment and OKR achievement',
      'Rate competencies and verify OKR completion',
      'Complete required cycle questions and supporting documents in the manual form',
      'AI assistance and Run AI Bias Check are optional; ChatGPT is not required for a manual review',
      'Submit your review to continue the configured discussion and approval steps'
    ],
    action: { label: 'View Appraisals', href: '/appraisals' }
  },
  {
    title: 'Conduct Appraisal Discussions',
    description: 'Meet with employees to discuss results',
    icon: <Chat color="secondary" />,
    details: [
      'Follow the cycle’s discussion step and record the agreed notes',
      'Discuss ratings, achievements, and development areas',
      'Create a development plan together',
      'Employee acknowledges to complete the process'
    ]
  },
  historyStep
];

const hrAdminSteps: TutorialStep[] = [
  {
    title: 'Create Appraisal Cycles',
    description: 'Set up and launch appraisal periods in one flow',
    icon: <Settings color="primary" />,
    details: [
      'Define cycle name, type, and period dates',
      'Configure phases and deadlines',
      'Set competencies to evaluate',
      'Choose OKR vs competency weight for final rating',
      'Enable or disable AI features, chat, and peer feedback',
      'Use Start appraisal to select staff and reviewers when you are ready to begin'
    ],
    action: { label: 'Create Cycle', href: '/admin/appraisal-cycles/new' }
  },
  startAppraisalStep,
  {
    title: 'Set Organization-wide OKRs',
    description: 'HR managers and organization administrators set shared organization goals',
    icon: <Flag color="primary" />,
    details: [
      'Open Goals in the Admin workspace and choose the organization view',
      'Create organization goals in an open goal period',
      'Teams and individuals can align their goals to these organization priorities'
    ],
    action: { label: 'Organization goals', href: '/okrs?view=organization' }
  },
  {
    title: 'Monitor Progress',
    description: 'Track completion across the organization',
    icon: <Timeline color="info" />,
    details: [
      'View real-time completion statistics',
      'Identify overdue appraisals',
      'Send reminders to pending reviewers',
      'Watch the workflow move automatically as employees and managers submit their stages'
    ]
  },
  {
    title: 'Conduct Calibration',
    description: 'Ensure fair and consistent ratings',
    icon: <TrendingUp color="warning" />,
    details: [
      'Review rating distribution across teams',
      'Identify potential bias or inconsistencies',
      'Adjust ratings if necessary with justification',
      'Finalize ratings after calibration'
    ],
    action: { label: 'Calibration', href: '/admin/calibration' }
  },
  {
    title: 'Generate Reports',
    description: 'Analyze organizational performance',
    icon: <Description color="secondary" />,
    details: [
      'View organization-wide performance summaries',
      'Export reports for leadership review',
      'Analyze trends over time',
      'Identify high performers and development needs'
    ],
    action: { label: 'Reports', href: '/admin/reports' }
  },
  historyStep
];

export default function TutorialPage() {
  const router = useRouter();
  const { isManager, isHRAdmin } = useUserContext();
  const theme = useTheme();
  const compactProgress = useMediaQuery(theme.breakpoints.down('sm'));
  const [activeSection, setActiveSection] = useState<'employee' | 'manager' | 'hr'>('employee');

  const renderSteps = (steps: TutorialStep[]) => (
    <Box>
      {steps.map((step, index) => (
        <Accordion key={index} defaultExpanded={index === 0}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar sx={{ bgcolor: 'primary.light', width: 40, height: 40 }}>
                {step.icon}
              </Avatar>
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>
                  Step {index + 1}: {step.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {step.description}
                </Typography>
              </Box>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <List dense>
              {step.details.map((detail, i) => (
                <ListItem key={i}>
                  <ListItemIcon>
                    <CheckCircle color="success" fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={detail} />
                </ListItem>
              ))}
            </List>
            {step.action && (
              <Button
                variant="contained"
                size="small"
                endIcon={<ArrowForward />}
                onClick={() => router.push(step.action!.href)}
                sx={{ mt: 2 }}
              >
                {step.action.label}
              </Button>
            )}
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Welcome to Performance Management
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Learn how to use the performance management portal effectively. Choose your role below to see relevant tutorials.
        </Typography>
      </Box>

      <Alert severity="info" sx={{ mb: 4 }}>
        Every page in the app now has its own in-context guide. Use the floating <strong>Guide</strong> button on any screen for page-specific instructions.
      </Alert>

      {/* Quick Start Card */}
      <Paper sx={{ p: 3, mb: 4, bgcolor: 'primary.lighter', border: 1, borderColor: 'primary.main' }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <Psychology color="primary" sx={{ fontSize: 40 }} />
          <Box>
            <Typography variant="h6" fontWeight={600} color="primary.main">
              Appraisals with Optional AI Support
            </Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Employees and reviewers can complete manual forms without ChatGPT. People review and approve the final ratings.
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Lightbulb color="warning" />
                  <Typography variant="body2"><strong>Self-Assessment:</strong> Complete the manual form or choose optional AI assistance</Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TrendingUp color="info" />
                  <Typography variant="body2"><strong>Manager Review:</strong> Record your judgment; AI insights and bias checks are optional</Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <VideoCall color="success" />
                  <Typography variant="body2"><strong>1:1 Meetings:</strong> Record agreed notes, support and follow-up actions</Typography>
                </Box>
              </Grid>
            </Grid>
          </Box>
        </Box>
      </Paper>

      {/* Role Selector */}
      <Box sx={{ mb: 4, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button
          variant={activeSection === 'employee' ? 'contained' : 'outlined'}
          startIcon={<Person />}
          onClick={() => setActiveSection('employee')}
        >
          Employee Guide
        </Button>
        {isManager && (
          <Button
            variant={activeSection === 'manager' ? 'contained' : 'outlined'}
            startIcon={<Groups />}
            onClick={() => setActiveSection('manager')}
          >
            Manager Guide
          </Button>
        )}
        {isHRAdmin && (
          <Button
            variant={activeSection === 'hr' ? 'contained' : 'outlined'}
            startIcon={<Settings />}
            onClick={() => setActiveSection('hr')}
          >
            HR Admin Guide
          </Button>
        )}
      </Box>

      {/* Role-specific Steps */}
      {activeSection === 'employee' && (
        <Box>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            <Person sx={{ mr: 1, verticalAlign: 'middle' }} />
            Employee Performance Journey
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Follow these steps throughout the year to maximize your performance review outcome.
          </Typography>
          {renderSteps(employeeSteps)}
        </Box>
      )}

      {activeSection === 'manager' && (
        <Box>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            <Groups sx={{ mr: 1, verticalAlign: 'middle' }} />
            Manager Performance Guide
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            As a manager, you play a crucial role in developing your team and evaluating their performance.
          </Typography>
          {renderSteps(managerSteps)}
        </Box>
      )}

      {activeSection === 'hr' && (
        <Box>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            <Settings sx={{ mr: 1, verticalAlign: 'middle' }} />
            HR Administrator Guide
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Manage the entire performance management process for your organization.
          </Typography>
          {renderSteps(hrAdminSteps)}
        </Box>
      )}

      {/* Performance Cycle Overview */}
      <Paper sx={{ p: 3, mt: 4 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          <Timeline sx={{ mr: 1, verticalAlign: 'middle' }} />
          Example Appraisal Workflow
        </Typography>
        <Typography variant="body2" color="text.secondary">HR configures the required steps. Open your appraisal to see its actual workflow; calibration and acknowledgement depend on that cycle.</Typography>
        <Stepper activeStep={-1} orientation={compactProgress ? 'vertical' : 'horizontal'} alternativeLabel={!compactProgress}
          role="group" aria-label="Example appraisal workflow" sx={{ mt: 3 }}>
          {[
            ['Goal Setting', 'Agree the goals for the period'],
            ['Self-Assessment', 'Employee reflects and adds evidence'],
            ['Manager Review', 'Reviewer records a human assessment'],
            ['Discussion', 'Discuss the findings and next steps'],
            ['Calibration', 'Check ratings when enabled'],
            ['Final Review', 'Approve and publish the result'],
            ['Acknowledgement', 'Employee reads the published outcome'],
          ].map(([label, description]) => <Step key={label} sx={{ minWidth: 0 }}>
            <StepLabel sx={{ '& .MuiStepLabel-label': { overflowWrap: 'anywhere' } }}>
              <Typography variant="caption">{label}</Typography>
              <Typography variant="caption" display="block" color="text.secondary">{description}</Typography>
            </StepLabel>
          </Step>)}
        </Stepper>
      </Paper>

      {/* Quick Links */}
      <Grid container spacing={3} sx={{ mt: 4 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Flag color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h6" fontWeight={600}>OKRs</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Set and track your objectives and key results
              </Typography>
              <Button variant="outlined" onClick={() => router.push('/okrs')}>
                View OKRs
              </Button>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Assessment color="warning" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h6" fontWeight={600}>Appraisals</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                View and complete your performance appraisals
              </Typography>
              <Button variant="outlined" onClick={() => router.push('/appraisals')}>
                View Appraisals
              </Button>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Feedback color="info" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h6" fontWeight={600}>Feedback</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Give and receive continuous feedback
              </Typography>
              <Button variant="outlined" onClick={() => router.push('/feedback')}>
                View Feedback
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

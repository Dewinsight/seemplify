'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserContext } from '@/lib/hooks';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, Paper,
  Stepper, Step, StepLabel, StepContent, Accordion, AccordionSummary,
  AccordionDetails, Divider, Avatar, List, ListItem, ListItemIcon,
  ListItemText, Alert
} from '@mui/material';
import {
  Assessment, Person, Groups, Feedback, EventNote, Star, Flag,
  CheckCircle, PlayArrow, ArrowForward, ExpandMore, Lightbulb,
  Psychology, TrendingUp, VideoCall, Chat, Description, Settings,
  Timeline, School, Rocket, EmojiEvents
} from '@mui/icons-material';

interface TutorialStep {
  title: string;
  description: string;
  icon: React.ReactNode;
  details: string[];
  action?: { label: string; href: string };
}

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
      'AI analysis helps identify patterns and areas for improvement'
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
      'Use AI suggestions to articulate your accomplishments',
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
  }
];

const managerSteps: TutorialStep[] = [
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
      'Use chat or video meetings (integrated with Nylas)',
      'AI analyzes meeting transcripts for insights',
      'Score meetings to track coaching effectiveness'
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
    action: { label: 'Give Feedback', href: '/feedback/new' }
  },
  {
    title: 'Complete Manager Reviews',
    description: 'Evaluate your team during appraisal cycles',
    icon: <Assessment color="warning" />,
    details: [
      'Wait for employees to complete self-assessments first',
      'Review their self-assessment and OKR achievement',
      'Rate competencies and verify OKR completion',
      'AI provides insights and checks for potential bias',
      'Submit your review for calibration'
    ],
    action: { label: 'View Appraisals', href: '/appraisals' }
  },
  {
    title: 'Conduct Appraisal Discussions',
    description: 'Meet with employees to discuss results',
    icon: <Chat color="secondary" />,
    details: [
      'Schedule a meeting after calibration is complete',
      'Discuss ratings, achievements, and development areas',
      'Create a development plan together',
      'Employee acknowledges to complete the process'
    ]
  }
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
      'Select the employees who should participate before you create the cycle'
    ],
    action: { label: 'Create Cycle', href: '/admin/appraisal-cycles/new' }
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
  }
];

export default function TutorialPage() {
  const router = useRouter();
  const { isManager, isHRAdmin, user, roleDisplay } = useUserContext();
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
              AI-Powered Performance Management
            </Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Our system uses AI to help you throughout the performance management process:
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Lightbulb color="warning" />
                  <Typography variant="body2"><strong>Self-Assessment:</strong> Get AI suggestions for writing achievements</Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TrendingUp color="info" />
                  <Typography variant="body2"><strong>Manager Review:</strong> AI-powered insights and bias detection</Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <VideoCall color="success" />
                  <Typography variant="body2"><strong>1:1 Meetings:</strong> Automatic transcript analysis and scoring</Typography>
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
          Typical Appraisal Cycle Phases
        </Typography>
        <Stepper alternativeLabel sx={{ mt: 3 }}>
          <Step completed>
            <StepLabel>
              <Typography variant="caption">Goal Setting</Typography>
              <Typography variant="caption" display="block" color="text.secondary">
                Define OKRs
              </Typography>
            </StepLabel>
          </Step>
          <Step>
            <StepLabel>
              <Typography variant="caption">Self-Assessment</Typography>
              <Typography variant="caption" display="block" color="text.secondary">
                Employee reflects
              </Typography>
            </StepLabel>
          </Step>
          <Step>
            <StepLabel>
              <Typography variant="caption">Manager Review</Typography>
              <Typography variant="caption" display="block" color="text.secondary">
                Manager evaluates
              </Typography>
            </StepLabel>
          </Step>
          <Step>
            <StepLabel>
              <Typography variant="caption">Calibration</Typography>
              <Typography variant="caption" display="block" color="text.secondary">
                HR ensures fairness
              </Typography>
            </StepLabel>
          </Step>
          <Step>
            <StepLabel>
              <Typography variant="caption">Final Review</Typography>
              <Typography variant="caption" display="block" color="text.secondary">
                Discussion & sign-off
              </Typography>
            </StepLabel>
          </Step>
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

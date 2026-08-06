import crypto from 'node:crypto';
import {
  journeyMapLimits, lanesForMapType,
  type JourneyCardKind, type JourneyExperienceType, type JourneyLaneDefinition, type JourneyLaneType, type JourneyMapType
} from './journeyDomain.js';

export type JourneyTemplateSeedCard = {
  laneType: JourneyLaneType;
  kind: JourneyCardKind;
  title: string;
  content?: string;
};

export type JourneyTemplateSeedStage = {
  key: string;
  name: string;
  goal: string;
  cards: JourneyTemplateSeedCard[];
};

export type JourneyTemplateSeed = {
  key: string;
  version: number;
  name: string;
  description: string;
  industry: string;
  useCase: string;
  experienceType: JourneyExperienceType;
  mapType: JourneyMapType;
  approvalState: 'draft';
  lanes: JourneyLaneDefinition[];
  stages: JourneyTemplateSeedStage[];
};

const goal = (title: string, content = ''): JourneyTemplateSeedCard => ({
  laneType: 'stage_goal', kind: 'goal', title, content
});
const touchpoint = (title: string): JourneyTemplateSeedCard => ({ laneType: 'touchpoints', kind: 'touchpoint', title });
const measure = (title: string): JourneyTemplateSeedCard => ({ laneType: 'metrics', kind: 'proposed_measure', title });

function stage(key: string, name: string, stageGoal: string, cards: JourneyTemplateSeedCard[] = []): JourneyTemplateSeedStage {
  return { key, name, goal: stageGoal, cards: [goal(stageGoal), ...cards] };
}

function template(input: Omit<JourneyTemplateSeed, 'version' | 'approvalState' | 'lanes'>): JourneyTemplateSeed {
  return {
    ...input, version: 1, approvalState: 'draft',
    lanes: lanesForMapType(input.mapType)
  };
}

/**
 * Required Phase 1 starting catalogue. These are deliberately draft seeds:
 * platform template governance must review and publish each immutable version
 * before customers can create from it. All cards are hypotheses and none carries
 * evidence or observed metrics.
 */
export const journeyTemplateSeeds: readonly JourneyTemplateSeed[] = [
  template({
    key: 'customer-onboarding', name: 'Customer onboarding', industry: 'Cross-industry', useCase: 'Onboarding',
    description: 'Map the route from initial commitment to repeatable first value.',
    experienceType: 'customer', mapType: 'current_state',
    stages: [
      stage('discover', 'Discover', 'Understand the offer and expected outcome', [touchpoint('Product or service information')]),
      stage('commit', 'Commit', 'Choose to begin and complete required registration', [touchpoint('Registration')]),
      stage('setup', 'Set up', 'Configure the essentials without avoidable delay', [touchpoint('Setup guidance')]),
      stage('first-value', 'Reach first value', 'Complete the first meaningful outcome', [measure('Time to first value')]),
      stage('adopt', 'Adopt', 'Repeat the outcome with confidence', [measure('Early repeat usage')])
    ]
  }),
  template({
    key: 'purchase', name: 'Purchase journey', industry: 'Cross-industry', useCase: 'Purchase',
    description: 'Examine evaluation, purchase, fulfilment, and initial use as one journey.',
    experienceType: 'customer', mapType: 'current_state',
    stages: [
      stage('explore', 'Explore', 'Understand available ways to meet the need', [touchpoint('Browse or enquiry')]),
      stage('evaluate', 'Evaluate', 'Compare relevant options and trade-offs', [measure('Evaluation completion')]),
      stage('purchase', 'Purchase', 'Complete the transaction with confidence', [touchpoint('Checkout or order')]),
      stage('receive', 'Receive', 'Receive the promised product or service', [measure('On-time fulfilment')]),
      stage('use', 'Use', 'Achieve the intended outcome after purchase', [measure('Post-purchase CSAT')])
    ]
  }),
  template({
    key: 'service-recovery', name: 'Service recovery', industry: 'Cross-industry', useCase: 'Service recovery',
    description: 'Trace a failure from detection through resolution and restored confidence.',
    experienceType: 'customer', mapType: 'current_state',
    stages: [
      stage('detect', 'Detect', 'Recognise the failure and understand its impact'),
      stage('contact', 'Seek help', 'Reach an appropriate support route', [touchpoint('Support entry point')]),
      stage('diagnose', 'Diagnose', 'Explain the issue once and agree what happens next', [measure('Repeat contact rate')]),
      stage('resolve', 'Resolve', 'Receive an effective and timely resolution', [measure('Time to resolution')]),
      stage('confirm', 'Confirm recovery', 'Confirm the outcome and rebuild confidence', [measure('Post-recovery CSAT')])
    ]
  }),
  template({
    key: 'renewal', name: 'Renewal journey', industry: 'Cross-industry', useCase: 'Renewal',
    description: 'Connect demonstrated value, renewal consideration, decision, and continued adoption.',
    experienceType: 'customer', mapType: 'future_state',
    stages: [
      stage('review-value', 'Review value', 'Understand outcomes achieved in the current period'),
      stage('consider', 'Consider renewal', 'Assess future needs, options, and constraints', [touchpoint('Renewal conversation')]),
      stage('decide', 'Decide', 'Make an informed renewal decision', [measure('Renewal conversion')]),
      stage('renew', 'Renew', 'Complete renewal without avoidable effort'),
      stage('next-value', 'Continue value', 'Begin the new period with a clear success plan', [measure('Renewed-account health')])
    ]
  }),
  template({
    key: 'employee-onboarding', name: 'Employee onboarding', industry: 'Cross-industry', useCase: 'Employee onboarding',
    description: 'Map preparation, first-day access, learning, contribution, and belonging.',
    experienceType: 'employee', mapType: 'current_state',
    stages: [
      stage('prepare', 'Prepare', 'Know what to expect before starting', [touchpoint('Pre-boarding communication')]),
      stage('first-day', 'Start', 'Gain access, context, and essential support'),
      stage('learn', 'Learn', 'Build the knowledge and relationships required for the role', [measure('Onboarding CES')]),
      stage('contribute', 'Contribute', 'Deliver the first meaningful contribution', [measure('Time to contribution')]),
      stage('belong', 'Belong', 'Develop confidence, connection, and a sustainable routine', [measure('New-starter sentiment')])
    ]
  }),
  template({
    key: 'citizen-service', name: 'Citizen service', industry: 'Public sector', useCase: 'Citizen service',
    description: 'Map discovery, application, verification, decision, and receipt of a public service.',
    experienceType: 'citizen', mapType: 'current_state',
    stages: [
      stage('eligibility', 'Understand eligibility', 'Know whether the service applies and what is required'),
      stage('apply', 'Apply', 'Submit a complete application', [touchpoint('Application channel')]),
      stage('verify', 'Verify', 'Provide evidence and understand progress', [measure('Avoidable evidence requests')]),
      stage('decision', 'Receive decision', 'Receive a clear, timely, explainable decision', [measure('Decision time')]),
      stage('service', 'Receive service', 'Access the approved service or next step', [measure('Citizen CSAT')])
    ]
  }),
  template({
    key: 'patient-access', name: 'Patient access', industry: 'Healthcare', useCase: 'Patient access',
    description: 'Map the administrative experience of finding, scheduling, attending, and following up care.',
    experienceType: 'patient', mapType: 'current_state',
    stages: [
      stage('seek', 'Seek care', 'Understand where and how to access appropriate care'),
      stage('schedule', 'Schedule', 'Secure a suitable appointment', [touchpoint('Scheduling channel'), measure('Time to appointment')]),
      stage('prepare', 'Prepare', 'Know what to do before the appointment'),
      stage('attend', 'Attend', 'Reach and complete the appointment with dignity', [measure('Access CES')]),
      stage('follow-up', 'Follow up', 'Understand and complete the agreed next steps', [measure('Follow-up completion')])
    ]
  }),
  template({
    key: 'blank-service-blueprint', name: 'Blank service blueprint', industry: 'Cross-industry', useCase: 'Service blueprint',
    description: 'Start with customer and operational lanes without presuming a particular service process.',
    experienceType: 'customer', mapType: 'service_blueprint',
    stages: [
      stage('request', 'Request', 'Express the need and enter the service'),
      stage('deliver', 'Deliver', 'Receive the core service outcome'),
      stage('complete', 'Complete', 'Confirm completion and any next step')
    ]
  })
] as const;

export function validateJourneyTemplateSeed(seed: JourneyTemplateSeed) {
  const issues: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(seed.key)) issues.push('key must use lower kebab case');
  if (seed.version < 1 || !Number.isInteger(seed.version)) issues.push('version must be a positive integer');
  if (!seed.name.trim()) issues.push('name is required');
  if (seed.stages.length === 0 || seed.stages.length > journeyMapLimits.stages) issues.push('stage count is outside limits');
  if (new Set(seed.stages.map((item) => item.key)).size !== seed.stages.length) issues.push('stage keys must be unique');
  if (seed.lanes.length === 0 || seed.lanes.length > journeyMapLimits.lanes) issues.push('lane count is outside limits');
  const laneTypes = new Set(seed.lanes.map((lane) => lane.laneType));
  for (const item of seed.stages) {
    if (!item.name.trim() || !item.goal.trim()) issues.push(`stage ${item.key} needs a name and goal`);
    for (const card of item.cards) {
      if (!laneTypes.has(card.laneType)) issues.push(`stage ${item.key} card uses unavailable lane ${card.laneType}`);
      if (!card.title.trim()) issues.push(`stage ${item.key} has an untitled card`);
    }
  }
  return issues;
}

export function journeyTemplateSeedChecksum(seed: JourneyTemplateSeed) {
  return crypto.createHash('sha256').update(JSON.stringify(seed)).digest('hex');
}

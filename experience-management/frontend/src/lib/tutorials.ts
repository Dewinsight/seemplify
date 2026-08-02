export type TutorialKey =
  | 'overview'
  | 'surveys'
  | 'campaigns'
  | 'agreements'
  | 'social-listening'
  | 'intelligence'
  | 'knowledge-bases'
  | 'journey-maps'
  | 'ai-queue'
  | 'service-recovery'
  | 'space-settings';

export interface TutorialCallout {
  label: string;
  detail: string;
  x: number;
  y: number;
}

export interface TutorialStep {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  callouts: TutorialCallout[];
  points: string[];
  note?: string;
}

export interface SectionTutorialDefinition {
  key: TutorialKey;
  version: number;
  section: string;
  description: string;
  steps: TutorialStep[];
}

const asset = (name: string) => `/tutorials/${name}.png`;

export const sectionTutorials: Record<TutorialKey, SectionTutorialDefinition> = {
  overview: {
    key: 'overview', version: 1, section: 'Overview',
    description: 'See what is happening across the active space and move quickly to the work that needs attention.',
    steps: [
      {
        title: 'Read the workspace at a glance',
        description: 'The overview brings current research, listening, delivery, and service activity into one operational view.',
        image: asset('overview'), imageAlt: 'Overview page with workspace summary, current activity, and priority work.',
        callouts: [
          { label: 'Workspace summary', detail: 'Counts reflect the space selected in the sidebar.', x: 23, y: 27 },
          { label: 'Recent work', detail: 'Return to surveys and reports that changed most recently.', x: 63, y: 46 },
          { label: 'Priority items', detail: 'Items needing action remain visible until resolved.', x: 79, y: 73 }
        ],
        points: ['Check the active space before interpreting totals.', 'Use recent work to resume where your team stopped.', 'Treat priority items as an operational inbox.']
      },
      {
        title: 'Start from the right section',
        description: 'The left navigation separates collection, distribution, analysis, knowledge, and service recovery.',
        image: asset('overview'), imageAlt: 'Overview page showing the primary navigation and create action.',
        callouts: [
          { label: 'Primary navigation', detail: 'Every product area keeps its own history and controls.', x: 11, y: 47 },
          { label: 'Create action', detail: 'The header action changes to suit the section you are viewing.', x: 88, y: 11 }
        ],
        points: ['Surveys collect structured feedback.', 'Social listening and intelligence turn evidence into findings.', 'Agreements and campaigns handle outbound workflows.']
      },
      {
        title: 'Keep operational context visible',
        description: 'Runtime state and queue links stay available without taking over the workspace.',
        image: asset('overview'), imageAlt: 'Overview page showing account, AI runtime, and queue access.',
        callouts: [
          { label: 'AI runtime', detail: 'See whether Terra is ready before starting AI work.', x: 10, y: 78 },
          { label: 'AI queue', detail: 'Open the durable job history when an analysis takes time.', x: 10, y: 67 },
          { label: 'Account and space', detail: 'Profile and space membership stay separate.', x: 12, y: 90 }
        ],
        points: ['Queued work can continue after you leave the page.', 'Changing spaces changes the data in every workspace section.', 'Your signed documents remain account-owned rather than space-owned.']
      }
    ]
  },
  surveys: {
    key: 'surveys', version: 1, section: 'Surveys',
    description: 'Build, publish, distribute, and analyse a survey from one workspace.',
    steps: [
      {
        title: 'Find or create a survey',
        description: 'The survey library keeps drafts, live surveys, and closed work together without mixing their responses.',
        image: asset('surveys'), imageAlt: 'Survey library with search, status, and new survey controls.',
        callouts: [
          { label: 'Search and status', detail: 'Narrow the list before opening a survey.', x: 31, y: 26 },
          { label: 'Survey row', detail: 'Open a survey to continue building or review results.', x: 54, y: 53 },
          { label: 'New survey', detail: 'Start manually or generate a structured draft with Terra.', x: 87, y: 12 }
        ],
        points: ['A draft is private to the space until published.', 'Closing a survey stops new responses without deleting history.', 'Names and descriptions can be changed later.']
      },
      {
        title: 'Move through the survey studio',
        description: 'The studio separates question design, distribution, responses, analytics, and AI work into clear tabs.',
        image: asset('surveys'), imageAlt: 'Survey studio with Build, Distribute, Responses, Analytics, Terra AI, and Settings tabs.',
        callouts: [
          { label: 'Build', detail: 'Add questions, reorder them, and configure logic.', x: 25, y: 20 },
          { label: 'Distribute', detail: 'Create public collectors and campaign links.', x: 43, y: 20 },
          { label: 'Results and Terra', detail: 'Review evidence before generating analysis.', x: 70, y: 20 }
        ],
        points: ['Save question changes before switching spaces.', 'Collectors control how a live survey is reached.', 'Terra outputs remain attached to the survey for later review.']
      },
      {
        title: 'Publish with a clear path to results',
        description: 'Use the live survey link for direct collection or select the survey inside a campaign for managed outreach.',
        image: asset('surveys'), imageAlt: 'Survey distribution and response analytics controls.',
        callouts: [
          { label: 'Live link', detail: 'Copy or open the respondent experience before sharing it.', x: 34, y: 42 },
          { label: 'Response history', detail: 'Inspect individual records without losing aggregate context.', x: 66, y: 54 },
          { label: 'Analytics', detail: 'Track completion and core experience metrics.', x: 79, y: 75 }
        ],
        points: ['Test the public link before sending broadly.', 'Campaigns add contacts, sequences, and delivery history.', 'Use response evidence when asking Terra for conclusions.']
      }
    ]
  },
  campaigns: {
    key: 'campaigns', version: 1, section: 'Campaigns',
    description: 'Select a survey, prepare an audience and sequence, then schedule and monitor delivery.',
    steps: [
      {
        title: 'Choose the campaign survey',
        description: 'Every campaign is tied to an explicit survey and collector so links and response attribution remain correct.',
        image: asset('campaigns'), imageAlt: 'Campaign setup workflow with survey selection and required-state guidance.',
        callouts: [
          { label: 'Workflow steps', detail: 'Visit steps freely while completion markers show what remains.', x: 43, y: 16 },
          { label: 'Survey selection', detail: 'Choose the intended survey instead of relying on a default.', x: 36, y: 43 },
          { label: 'Required guidance', detail: 'Issues explain exactly what blocks launch.', x: 76, y: 71 }
        ],
        points: ['A campaign never assumes the first survey.', 'Required fields are visible before review.', 'Drafts remain editable until launch.']
      },
      {
        title: 'Build the audience and sequence',
        description: 'Add people directly or import a list, then prepare one or more timed messages.',
        image: asset('campaigns'), imageAlt: 'Campaign audience and email sequence editor.',
        callouts: [
          { label: 'Audience', detail: 'Names, positions, companies, and custom fields support personalisation.', x: 28, y: 48 },
          { label: 'Sequence', detail: 'Add follow-ups and choose plain text or HTML deliberately.', x: 62, y: 39 },
          { label: 'Survey insertion', detail: 'Embed or link the selected survey in each message.', x: 73, y: 67 }
        ],
        points: ['Preview imported columns before adding contacts.', 'Plain text is the safest default for deliverability.', 'Stop-on-response prevents unnecessary follow-ups.']
      },
      {
        title: 'Schedule, review, and monitor',
        description: 'A campaign cannot launch until its start time and every required workflow section are complete.',
        image: asset('campaigns'), imageAlt: 'Campaign schedule, review checklist, and delivery activity.',
        callouts: [
          { label: 'Start time', detail: 'Set the intended time and confirm the displayed timezone.', x: 32, y: 44 },
          { label: 'Review', detail: 'Resolve every blocking issue before launch.', x: 60, y: 52 },
          { label: 'Activity', detail: 'Delivery and provider events remain available after launch.', x: 80, y: 69 }
        ],
        points: ['The launch button stays disabled while requirements are missing.', 'Pause a live campaign before changing its operating plan.', 'Use delivery history to investigate bounces or failures.']
      }
    ]
  },
  agreements: {
    key: 'agreements', version: 1, section: 'Agreements',
    description: 'Prepare documents, route recipients, place signing fields, and retain a verifiable completion record.',
    steps: [
      {
        title: 'Prepare documents and recipients',
        description: 'The agreement workflow makes document and recipient requirements visible before anything is sent.',
        image: asset('agreements'), imageAlt: 'Agreement preparation workflow with documents and recipients.',
        callouts: [
          { label: 'Preparation workflow', detail: 'Completion markers show which step needs attention.', x: 43, y: 15 },
          { label: 'Documents', detail: 'Upload the PDFs recipients must review.', x: 31, y: 46 },
          { label: 'Recipients', detail: 'Set roles, order, and optional access codes.', x: 70, y: 48 }
        ],
        points: ['Every signer needs a signature or initials field.', 'Sequential routing waits for earlier recipients.', 'Access codes should be shared separately from email.']
      },
      {
        title: 'Place fields directly on the document',
        description: 'The field editor opens in the Fields step so placement, ownership, and page context stay together.',
        image: asset('agreements'), imageAlt: 'PDF agreement editor with recipient assignment and placed fields.',
        callouts: [
          { label: 'Field tools', detail: 'Choose signatures, initials, text, choices, and dates.', x: 15, y: 38 },
          { label: 'Recipient assignment', detail: 'Every new field belongs to the selected recipient.', x: 19, y: 22 },
          { label: 'Document canvas', detail: 'Place and resize fields on the correct page.', x: 64, y: 53 }
        ],
        points: ['Check the assignee before placing several fields.', 'Save field changes before leaving the editor.', 'Required fields block completion for their recipient.']
      },
      {
        title: 'Send and retain the record',
        description: 'Review readiness before sending, then follow recipient progress, delivery, final PDFs, and the certificate.',
        image: asset('agreements'), imageAlt: 'Agreement review and activity showing recipient progress and completed files.',
        callouts: [
          { label: 'Readiness', detail: 'Review and send stays disabled until the agreement is complete.', x: 34, y: 34 },
          { label: 'Recipient progress', detail: 'See who is waiting, viewing, or complete.', x: 59, y: 52 },
          { label: 'Completed artifacts', detail: 'Download the signed PDF and completion certificate.', x: 78, y: 73 }
        ],
        points: ['Reminders target recipients who can still act.', 'Voiding is irreversible and revokes outstanding links.', 'Completed recipients can keep their copies in My signed documents.']
      }
    ]
  },
  'social-listening': {
    key: 'social-listening', version: 1, section: 'Social listening',
    description: 'Connect X accounts, collect relevant posts and mentions, and turn them into reviewable intelligence.',
    steps: [
      {
        title: 'Connect the right X account',
        description: 'Each connection authorises independently, so listening history remains attributable to the correct account.',
        image: asset('social-listening'), imageAlt: 'Social listening page with connected X accounts and connection status.',
        callouts: [
          { label: 'Account selector', detail: 'Choose which authorised account you are reviewing.', x: 34, y: 25 },
          { label: 'Connection state', detail: 'Check authentication and last successful sync before analysis.', x: 72, y: 26 },
          { label: 'Connect account', detail: 'Authorise another X identity without replacing existing accounts.', x: 87, y: 13 }
        ],
        points: ['Connections belong to the active space.', 'A failed sync does not remove previously collected evidence.', 'Platform credentials are separate from member authorisation.']
      },
      {
        title: 'Define and run listening',
        description: 'Queries and sync controls determine which recent posts, mentions, and search results enter the evidence set.',
        image: asset('social-listening'), imageAlt: 'Listening queries, sync controls, and collected social posts.',
        callouts: [
          { label: 'Listening queries', detail: 'Use focused terms and exclusions to reduce noise.', x: 27, y: 43 },
          { label: 'Sync', detail: 'Run a collection now or use the configured schedule.', x: 81, y: 22 },
          { label: 'Evidence feed', detail: 'Inspect source text before using AI analysis.', x: 60, y: 68 }
        ],
        points: ['Query syntax follows X recent-search rules.', 'Sync state and failures remain visible historically.', 'Collected posts retain their source URL and timestamp.']
      },
      {
        title: 'Create intelligence, not automatic replies',
        description: 'Terra can analyse selected evidence and draft a response, but posting remains a deliberate human action.',
        image: asset('social-listening'), imageAlt: 'Social intelligence analysis and AI reply-draft controls.',
        callouts: [
          { label: 'Analyse selection', detail: 'Choose the posts that support the report.', x: 35, y: 62 },
          { label: 'Draft reply', detail: 'Generate editable language for a single post.', x: 72, y: 55 },
          { label: 'Saved reports', detail: 'Return to prior intelligence rather than regenerating it.', x: 79, y: 78 }
        ],
        points: ['Terra drafts are never posted automatically.', 'Keep source evidence attached to every conclusion.', 'Combine saved social reports with survey findings in Intelligence.']
      }
    ]
  },
  intelligence: {
    key: 'intelligence', version: 1, section: 'Intelligence',
    description: 'Combine selected survey and social evidence into a traceable cross-source report.',
    steps: [
      {
        title: 'Choose the evidence deliberately',
        description: 'Intelligence begins with an explicit source set; nothing is pulled into a report automatically.',
        image: asset('intelligence'), imageAlt: 'Intelligence workspace with survey and social source selection.',
        callouts: [
          { label: 'Survey sources', detail: 'Select completed survey analysis relevant to the objective.', x: 28, y: 43 },
          { label: 'Social sources', detail: 'Add saved listening reports that cover the same question.', x: 61, y: 43 },
          { label: 'Selected evidence', detail: 'Review the final source set before generation.', x: 78, y: 68 }
        ],
        points: ['Source selection is report-specific.', 'Fewer relevant sources are better than a broad noisy set.', 'Original reports stay unchanged.']
      },
      {
        title: 'Set the objective and optional context',
        description: 'A precise objective guides synthesis; an allowed knowledge base can add internal context when needed.',
        image: asset('intelligence'), imageAlt: 'Intelligence objective form and optional knowledge-base picker.',
        callouts: [
          { label: 'Objective', detail: 'State the decision or question the report must address.', x: 38, y: 37 },
          { label: 'Knowledge context', detail: 'Select only ready sources approved for Terra context.', x: 66, y: 55 },
          { label: 'Generate', detail: 'Queue a durable synthesis after reviewing inputs.', x: 82, y: 78 }
        ],
        points: ['Knowledge context is optional.', 'Private knowledge is never selected silently.', 'Generation continues in the AI queue if you leave.']
      },
      {
        title: 'Review findings with provenance',
        description: 'Saved reports separate conclusions, risks, recommendations, and evidence so the output can be challenged later.',
        image: asset('intelligence'), imageAlt: 'Completed intelligence report with findings, evidence, and report history.',
        callouts: [
          { label: 'Findings', detail: 'Read the synthesis alongside its limitations.', x: 37, y: 42 },
          { label: 'Evidence references', detail: 'Trace claims back to selected sources.', x: 69, y: 53 },
          { label: 'Report history', detail: 'Earlier outputs remain available for comparison.', x: 81, y: 75 }
        ],
        points: ['Treat unsupported claims as issues to investigate.', 'Keep contradictory findings rather than averaging them away.', 'Create a new report when the source set changes materially.']
      }
    ]
  },
  'knowledge-bases': {
    key: 'knowledge-bases', version: 1, section: 'Knowledge bases',
    description: 'Index internal documents for cited hybrid search and optional Terra context.',
    steps: [
      {
        title: 'Set access and AI consent',
        description: 'Knowledge visibility and permission to send retrieved context to Terra are separate decisions.',
        image: asset('knowledge-bases'), imageAlt: 'Knowledge base settings with access and Terra context controls.',
        callouts: [
          { label: 'Access', detail: 'Choose private-to-me or visible-to-space.', x: 31, y: 42 },
          { label: 'Terra context', detail: 'Enable only when this material may be used in supported AI requests.', x: 63, y: 48 },
          { label: 'State', detail: 'Ready, indexing, degraded, and failed states remain explicit.', x: 80, y: 25 }
        ],
        points: ['Space visibility does not automatically enable Terra.', 'Private bases stay unavailable in shared AI workflows.', 'Settings affect new requests, not saved historical outputs.']
      },
      {
        title: 'Upload and follow durable indexing',
        description: 'Documents are extracted, chunked, embedded, and connected into the graph through a restart-safe queue.',
        image: asset('knowledge-bases'), imageAlt: 'Knowledge base upload area and document indexing history.',
        callouts: [
          { label: 'Upload', detail: 'Drop supported files and review them before indexing.', x: 31, y: 31 },
          { label: 'Document state', detail: 'See the current extraction or indexing stage.', x: 56, y: 58 },
          { label: 'Indexing history', detail: 'Attempts and errors remain visible after completion.', x: 79, y: 73 }
        ],
        points: ['Leaving the page does not cancel an indexing job.', 'A failed document can be diagnosed without losing other sources.', 'Deletion removes its chunks and graph claims.']
      },
      {
        title: 'Test retrieval and provenance',
        description: 'Search combines lexical, vector, and graph evidence, then returns citations you can inspect.',
        image: asset('knowledge-bases'), imageAlt: 'Knowledge search results with citations and graph provenance.',
        callouts: [
          { label: 'Search and test', detail: 'Ask a question against this base before using it elsewhere.', x: 31, y: 31 },
          { label: 'Citations', detail: 'Open document, page, section, and excerpt evidence.', x: 63, y: 51 },
          { label: 'Graph provenance', detail: 'Inspect relationships and the source passage supporting them.', x: 79, y: 72 }
        ],
        points: ['A fluent answer is not a substitute for cited evidence.', 'Graph relationships are constrained to extracted source spans.', 'Use the picker in supported AI workflows to add this context.']
      }
    ]
  },
  'journey-maps': {
    key: 'journey-maps', version: 1, section: 'Journey maps',
    description: 'Describe a customer journey stage by stage while keeping hypotheses distinct from observed evidence.',
    steps: [
      {
        title: 'Define one journey clearly',
        description: 'A focused audience, objective, and scope keep every stage about the same experience.',
        image: asset('journey-maps'), imageAlt: 'Journey map workspace with audience, objective, and generation controls.',
        callouts: [
          { label: 'Journey scope', detail: 'Name the audience and outcome before adding stages.', x: 32, y: 31 },
          { label: 'Create manually', detail: 'Start from known stages when the team already has a model.', x: 68, y: 29 },
          { label: 'Generate with Terra', detail: 'Use a brief and optional selected knowledge context.', x: 83, y: 29 }
        ],
        points: ['Create separate maps for materially different audiences.', 'Generated journeys begin as hypotheses.', 'Knowledge bases are used only when explicitly selected.']
      },
      {
        title: 'Read each stage as a decision unit',
        description: 'Stages organise goals, actions, touchpoints, emotions, pain points, measures, and opportunities.',
        image: asset('journey-maps'), imageAlt: 'Journey stages with actions, pain points, metrics, and opportunities.',
        callouts: [
          { label: 'Stage sequence', detail: 'Follow the experience in the order the customer encounters it.', x: 44, y: 23 },
          { label: 'Observed experience', detail: 'Capture actions, touchpoints, emotions, and pain points.', x: 34, y: 57 },
          { label: 'Improvement plan', detail: 'Keep opportunities and recommended actions separate from observations.', x: 73, y: 61 }
        ],
        points: ['Use concrete customer behaviour rather than internal process labels.', 'Attach meaningful metrics to the stage they measure.', 'Treat recommendations as proposals until validated.']
      },
      {
        title: 'Edit, optimise, and retain history',
        description: 'Workspace edits and Terra optimisation create traceable versions instead of silently replacing prior work.',
        image: asset('journey-maps'), imageAlt: 'Journey editor with stage controls, provenance, and version history.',
        callouts: [
          { label: 'Stage controls', detail: 'Add, reorder, edit, or remove a stage deliberately.', x: 39, y: 48 },
          { label: 'Provenance', detail: 'See whether the current map came from workspace editing or Terra.', x: 72, y: 27 },
          { label: 'Version history', detail: 'Restore or compare displaced versions when direction changes.', x: 80, y: 75 }
        ],
        points: ['Save a workspace edit before requesting optimisation.', 'Review displaced stages after an AI change.', 'Use research evidence to replace hypotheses over time.']
      }
    ]
  },
  'ai-queue': {
    key: 'ai-queue', version: 1, section: 'AI queue',
    description: 'Follow durable AI work across Terra and hosted providers without keeping the originating page open.',
    steps: [
      {
        title: 'Understand job state',
        description: 'Every durable activity records its queue state, current stage, progress, and attempt count.',
        image: asset('ai-queue'), imageAlt: 'AI queue table with state, progress, attempt, and timestamps.',
        callouts: [
          { label: 'Activity', detail: 'The activity identifies what the model was asked to do.', x: 24, y: 34 },
          { label: 'State and progress', detail: 'Queued, processing, completed, and failed remain distinct.', x: 52, y: 43 },
          { label: 'Attempt', detail: 'Retries are recorded rather than replacing earlier execution state.', x: 76, y: 44 }
        ],
        points: ['Queued work is safe to leave.', 'Processing progress reflects durable worker stages.', 'A retry does not create a duplicate business result.']
      },
      {
        title: 'Inspect completion or failure',
        description: 'Completed jobs link back to their saved output; failures retain a usable operational explanation.',
        image: asset('ai-queue'), imageAlt: 'AI queue with completed and failed job details.',
        callouts: [
          { label: 'Completed work', detail: 'Return to the source survey, report, or knowledge base.', x: 33, y: 58 },
          { label: 'Failure detail', detail: 'Use the recorded error to decide whether to retry or correct inputs.', x: 69, y: 65 },
          { label: 'Timestamps', detail: 'Compare queue delay and processing duration.', x: 84, y: 42 }
        ],
        points: ['Correct invalid inputs before retrying.', 'Provider outages should wait or retry according to activity policy.', 'Saved outputs remain in their owning workspace section.']
      },
      {
        title: 'Use the queue as an audit trail',
        description: 'Filters and retained history help distinguish current workload from earlier provider and validation issues.',
        image: asset('ai-queue'), imageAlt: 'AI queue filters and retained activity history.',
        callouts: [
          { label: 'Filters', detail: 'Narrow by state or activity when investigating a workflow.', x: 31, y: 23 },
          { label: 'Historical rows', detail: 'Completed and failed jobs remain visible for later review.', x: 56, y: 67 },
          { label: 'Refresh', detail: 'Live refresh updates state without resubmitting work.', x: 88, y: 16 }
        ],
        points: ['Refreshing a page does not enqueue another job.', 'Use timestamps and attempts when reporting an incident.', 'Provider runtime details belong to the job that produced the output.']
      }
    ]
  },
  'service-recovery': {
    key: 'service-recovery', version: 1, section: 'Service recovery',
    description: 'Turn feedback issues into owned follow-up work and retain the path from evidence to resolution.',
    steps: [
      {
        title: 'Work from the recovery queue',
        description: 'Tickets bring response-driven issues together with their priority, state, and ownership.',
        image: asset('service-recovery'), imageAlt: 'Service recovery queue with priority, status, and assignee.',
        callouts: [
          { label: 'Queue filters', detail: 'Focus on open, urgent, or assigned work.', x: 31, y: 25 },
          { label: 'Priority and state', detail: 'Separate urgency from workflow status.', x: 57, y: 48 },
          { label: 'Owner', detail: 'Make responsibility explicit before follow-up begins.', x: 78, y: 48 }
        ],
        points: ['Triage new issues before working the oldest item blindly.', 'Assign a clear owner.', 'Keep the originating feedback attached.']
      },
      {
        title: 'Review the customer context',
        description: 'Open a ticket to see the source response, issue summary, and relevant contact details together.',
        image: asset('service-recovery'), imageAlt: 'Service recovery ticket detail with source response and customer context.',
        callouts: [
          { label: 'Issue summary', detail: 'Confirm the problem before choosing a recovery action.', x: 34, y: 35 },
          { label: 'Source evidence', detail: 'Read the customer response in its original context.', x: 37, y: 65 },
          { label: 'Recovery details', detail: 'Record ownership, status, and follow-up notes.', x: 75, y: 55 }
        ],
        points: ['Do not infer missing customer details.', 'Use the source response to keep follow-up specific.', 'Avoid placing sensitive information in general notes.']
      },
      {
        title: 'Close the loop',
        description: 'Update the ticket as contact is made, action is taken, and the issue is resolved.',
        image: asset('service-recovery'), imageAlt: 'Service recovery activity and resolution controls.',
        callouts: [
          { label: 'Status', detail: 'Move work through a consistent recovery workflow.', x: 34, y: 41 },
          { label: 'Activity', detail: 'Keep a concise history of decisions and customer contact.', x: 62, y: 59 },
          { label: 'Resolution', detail: 'Close only when the recovery outcome is recorded.', x: 79, y: 75 }
        ],
        points: ['Record what changed for the customer.', 'Use reopened work when the issue is not actually resolved.', 'Review recurring recovery themes in analytics and intelligence.']
      }
    ]
  },
  'space-settings': {
    key: 'space-settings', version: 1, section: 'Space settings',
    description: 'Manage the boundary around shared surveys, campaigns, agreements, evidence, and AI work.',
    steps: [
      {
        title: 'Know which space you are changing',
        description: 'The active space is the tenant boundary for workspace data, membership, and most operational settings.',
        image: asset('space-settings'), imageAlt: 'Space settings page with active-space name and membership role.',
        callouts: [
          { label: 'Active space', detail: 'Confirm the selected space before changing settings.', x: 27, y: 23 },
          { label: 'Space details', detail: 'Owners can rename the workspace without moving its data.', x: 38, y: 46 },
          { label: 'Your role', detail: 'Permissions depend on membership in this space.', x: 75, y: 31 }
        ],
        points: ['Spaces isolate operational data from unrelated accounts.', 'A personal space is created automatically.', 'Renaming a space does not change ownership or history.']
      },
      {
        title: 'Invite and manage members',
        description: 'Membership is explicit: people see a space only after accepting an invitation for their verified email.',
        image: asset('space-settings'), imageAlt: 'Space member and invitation management controls.',
        callouts: [
          { label: 'Members', detail: 'Review who currently has access and their role.', x: 35, y: 45 },
          { label: 'Invite member', detail: 'Choose an email and the minimum role they need.', x: 79, y: 27 },
          { label: 'Pending invitations', detail: 'Revoke invitations that should no longer be usable.', x: 62, y: 72 }
        ],
        points: ['Invite the address the person will verify.', 'Use member rather than admin unless management access is needed.', 'An invitation never exposes another personal space.']
      },
      {
        title: 'Create and switch spaces safely',
        description: 'Use separate spaces for teams or clients that must not share surveys, contacts, reports, or integrations.',
        image: asset('space-settings'), imageAlt: 'Space selector and create-space workflow.',
        callouts: [
          { label: 'Space selector', detail: 'Switch the full workspace context from the sidebar.', x: 13, y: 19 },
          { label: 'Create space', detail: 'Start a separate boundary for another team or body of work.', x: 20, y: 30 },
          { label: 'Isolation reminder', detail: 'Confirm before leaving unsaved work in the current space.', x: 65, y: 61 }
        ],
        points: ['Switching spaces changes every space-scoped API request.', 'Unsaved editors warn before a switch.', 'Invite collaborators separately to each shared space.']
      }
    ]
  }
};

const tutorialMatchers: Array<{ key: TutorialKey; matches: (pathname: string) => boolean }> = [
  { key: 'overview', matches: (pathname) => pathname === '/' },
  { key: 'surveys', matches: (pathname) => pathname === '/surveys' || pathname.startsWith('/surveys/') },
  { key: 'campaigns', matches: (pathname) => pathname === '/campaigns' || pathname.startsWith('/campaigns/') },
  { key: 'agreements', matches: (pathname) => pathname === '/agreements' || pathname.startsWith('/agreements/') },
  { key: 'social-listening', matches: (pathname) => pathname === '/social-listening' },
  { key: 'intelligence', matches: (pathname) => pathname === '/intelligence' },
  { key: 'knowledge-bases', matches: (pathname) => pathname === '/knowledge-bases' || pathname.startsWith('/knowledge-bases/') },
  { key: 'journey-maps', matches: (pathname) => pathname === '/journeys' },
  { key: 'ai-queue', matches: (pathname) => pathname === '/ai-queue' },
  { key: 'service-recovery', matches: (pathname) => pathname === '/tickets' },
  { key: 'space-settings', matches: (pathname) => pathname === '/settings/space' }
];

export function tutorialForPath(pathname: string) {
  const match = tutorialMatchers.find((item) => item.matches(pathname));
  return match ? sectionTutorials[match.key] : null;
}

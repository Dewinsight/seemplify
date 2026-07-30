export type SpaceRole = 'owner' | 'admin' | 'member';
export interface SpaceSummary { id: string; name: string; slug: string; role: SpaceRole; isPersonal: boolean; createdAt: string; updatedAt: string }
export interface SessionUser { id: string; email: string; name: string; role: string }
export type ProfileGoal = 'customer_experience' | 'employee_experience' | 'market_research' | 'all_experience' | null;
export interface UserProfile {
  name: string; email: string; jobTitle: string; organizationName: string; timezone: string;
  primaryGoal: ProfileGoal; onboardingVersion: number; completedAt: string | null;
}
export interface AuthSession {
  authenticated: boolean; email: string | null; user: SessionUser | null;
  emailVerified: boolean; onboardingRequired: boolean; profile: UserProfile | null;
  permissions?: { platformAdmin: boolean; rootPlatformAdmin: boolean; platformRoles: Array<'superadmin' | 'support' | 'billing_approver' | 'analyst'> };
  spaces: SpaceSummary[]; activeSpace: SpaceSummary | null; pendingSpaceInvitations: PendingSpaceInvitation[];
}
export interface SpaceSession { spaces: SpaceSummary[]; activeSpace: SpaceSummary }
export interface PendingSpaceInvitation {
  id: string; role: Exclude<SpaceRole, 'owner'>; expiresAt: string; createdAt: string; invitedBy: string;
  space: Pick<SpaceSummary, 'id' | 'name'>;
}
export interface SpaceMember { id: string; name: string; email: string; role: SpaceRole; joinedAt: string }
export interface SpaceInvitation {
  id: string; email: string; role: Exclude<SpaceRole, 'owner'>; expiresAt: string;
  acceptedAt: string | null; revokedAt: string | null; createdAt: string; invitedBy: string;
}
export interface SpaceInvitationPreview {
  email: string; role: Exclude<SpaceRole, 'owner'>; expiresAt: string;
  space: Pick<SpaceSummary, 'id' | 'name'>; invitedBy: string;
}

export type QuestionType = 'single_choice' | 'multiple_choice' | 'dropdown' | 'nps' | 'multi_nps' | 'csat' | 'ces' | 'short_text' | 'multi_text' | 'long_text' | 'email' | 'number' | 'rating' | 'graphical_rating' | 'slider' | 'ranking' | 'matrix' | 'date' | 'contact' | 'file' | 'media' | 'statement';
export interface LogicRule { action: 'show' | 'hide' | 'skip_to' | 'create_ticket'; sourceQuestionId: string; operator: string; value: string | number; targetQuestionId?: string }
export interface Question { id: string; surveyId: string; page: number; position: number; type: QuestionType; title: string; description: string; required: boolean; options: string[]; settings: Record<string, any>; logic: LogicRule[] }
export interface Survey { id: string; title: string; description: string; purpose: 'customer_experience' | 'employee_experience' | 'market_research'; audience: string; status: 'draft' | 'live' | 'closed'; primaryMetric: 'nps' | 'csat' | 'ces' | 'custom'; language: string; thankYouMessage: string; theme: Record<string, any>; settings: Record<string, any>; createdAt: string; updatedAt: string; publishedAt: string | null; questions?: Question[]; responseCount?: number; collectorCount?: number }
export interface Collector { id: string; surveyId: string; name: string; type: 'web' | 'email' | 'api' | 'qr' | 'manual' | 'kiosk'; slug: string; status: 'open' | 'closed'; settings: Record<string, any>; createdAt: string; publicUrl: string; responseCount?: number; recipientCount?: number }
export interface ResponseRecord { id: string; surveyId: string; collectorId: string; respondentToken: string; status: 'partial' | 'completed'; answers: Record<string, any>; metadata: Record<string, any>; startedAt: string; completedAt: string | null; durationSeconds: number | null; aiAnalysis: any; analyzedAt: string | null }
export type RecoveryTicketStatus = 'open' | 'in_progress' | 'closed';
export type RecoveryTicketPriority = 'normal' | 'high' | 'urgent';
export interface RecoveryTicketEvent {
  id: string; eventType: string; detail: Record<string, any>; createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}
export interface RecoveryTicket {
  id: string; surveyId: string; responseId: string | null; title: string; priority: RecoveryTicketPriority;
  status: RecoveryTicketStatus; owner: string; notes: string; createdAt: string; updatedAt: string;
  survey: Pick<Survey, 'id' | 'title'>; respondent: { name: string; email: string } | null;
  responseCompletedAt: string | null; eventCount: number;
}
export interface RecoveryTicketDetail extends RecoveryTicket {
  survey: Survey;
  response: null | Pick<ResponseRecord, 'id' | 'status' | 'answers' | 'metadata' | 'startedAt' | 'completedAt' | 'durationSeconds' | 'aiAnalysis' | 'analyzedAt'>;
  events: RecoveryTicketEvent[];
}
export interface AiJobKnowledgeContext {
  query: string;
  knowledgeBases: Array<{ id: string; name: string; indexVersion: number; embeddingProfile?: Record<string, any> }>;
  citations: Array<{ sourceRef: string; knowledgeBaseId: string; documentId: string; documentName: string; excerpt: string; page?: number | null; score?: number | null }>;
  metrics: Record<string, any>;
  createdAt: string;
}
export interface AiJob { id: string; kind: string; surveyId: string | null; responseId: string | null; state: 'queued' | 'processing' | 'completed' | 'failed'; stage: string; progress: number; attempt: number; input: Record<string, any>; result: any; error: string | null; retryAt: string | null; createdAt: string; startedAt: string | null; completedAt: string | null; updatedAt: string; knowledgeContext?: AiJobKnowledgeContext | null }
export interface Template { id: string; name: string; description: string; purpose: Survey['purpose']; primaryMetric: Survey['primaryMetric']; audience: string; questions: Partial<Question>[] }
export interface SurveyDetail { survey: Survey; collectors: Collector[]; insights: { id: string; kind: string; payload: any; createdAt: string }[] }
export interface SocialMention { id: string; source: 'x' | 'google_play' | 'app_store' | 'review' | 'forum' | 'other'; externalId?: string | null; xConnectionId?: string | null; ingestionKind?: 'account_post' | 'mention' | 'search' | null; author: string; content: string; url: string; language: string; publishedAt: string; metadata: Record<string, any>; analysis: any; createdAt: string }
export interface XListeningQuery {
  id: string; label: string; query: string; enabled: boolean; configurationVersion: number;
  sinceId: string | null; oldestId: string | null; catchUpPending: boolean; historyExhausted: boolean;
  lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null; createdAt: string; updatedAt: string;
}
export type XCollectionStream = 'account_posts' | 'mentions' | 'searches';
export interface XSyncTarget {
  key: string; stream: XCollectionStream; queryId: string | null; budget: number; fetchedCount: number; remaining: number;
  state: 'queued' | 'processing' | 'completed' | 'skipped'; hasMore: boolean; updatedAt: string; completedAt: string | null;
}
export interface XSyncJob {
  id: string; connectionId: string; trigger: 'manual' | 'scheduled' | 'expansion'; mode?: 'incremental' | 'expansion';
  state: 'queued' | 'processing' | 'waiting_rate_limit' | 'waiting_billing' | 'completed' | 'failed' | 'cancelled';
  stage: string; progress: number; attempt: number; creditProbe: boolean; runAfter: string | null;
  requestedLimit?: number; maximumPostsRead?: number; providerRequests?: number; reusedCount?: number; newCount?: number;
  streams?: XCollectionStream[]; hasMore?: boolean; deferredSearchQueries?: number; selectedQueryIds?: string[]; targets?: XSyncTarget[];
  postsFetched: number; mentionsFetched: number; searchFetched: number; importedCount: number;
  analysisJobId: string | null; error: string | null; createdAt: string; startedAt: string | null; completedAt: string | null; updatedAt: string;
}
export interface XExpansionEstimate {
  connectionId: string; mode: 'expansion'; requestedLimit: number; boundedLimit: number; planFingerprint: string;
  minimumLimit: number; maximumLimit: number; normalSyncLimit: number; streams: XCollectionStream[];
  storedCount: number; canManagePaidCollection: boolean; alreadyStoredExcluded: boolean; cachedPostsDeduplicatedAfterFetch: boolean;
  estimated: {
    maximumNewPosts: number; maximumProviderRows: number; maximumUniqueNewPosts: number; providerRequests: number; payablePostsUpperBound: number;
    budgets?: Record<string, number>;
    standardPostReadUsd?: number; maximumEstimatedCostUsd?: number; ownedPostReadUsd?: number; pricingBasis?: string;
  };
  cache?: { strategy: string; incrementalHighWater: boolean; historicalLowWater: boolean; providerCursorAvoidance: boolean; crossStreamOverlapPossible: boolean };
  selectedQueryIds?: string[]; selectedQueryCount: number; deferredSearchQueryIds?: string[]; deferredQueryCount: number;
  exhaustedTargets?: string[]; historyExhaustedStreams: string[]; eligibleTargets?: string[];
  pricingCheckedAt?: string; disclaimer?: string; ownedReadNote?: string; generatedAt: string;
}
export interface XConnection {
  id: string; status: string; authType: 'oauth1' | 'oauth2'; scopes: string[]; tokenExpiresAt: string | null;
  account: null | { id: string; username: string | null; name: string | null; profileImageUrl: string | null };
  autoSync: boolean; syncIntervalMinutes: number; nextSyncAt: string | null; lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null;
  cursors?: { latestPostId: string | null; latestMentionId: string | null; oldestPostId: string | null; oldestMentionId: string | null };
  catchUp?: { accountPosts: { pending: boolean; lowId: string | null }; mentions: { pending: boolean; lowId: string | null } };
  history?: { accountPostsExhausted: boolean; mentionsExhausted: boolean };
  rateLimits: Record<string, { limit: number | null; remaining: number | null; resetAt: string | null; observedAt: string }>;
  createdAt: string; updatedAt: string; counts?: { collected: number; accountPosts: number; mentions: number; searchResults: number; analyzed: number };
}
export interface XIntegrationStatus {
  provider: 'x'; callbackUrl: string; canManageAppCredentials: boolean; canManagePaidCollection: boolean;
  collectionPolicy?: { normalSyncLimit: number; minimumExpansionLimit: number; maximumExpansionLimit: number; cacheStrategy: string; alreadyStoredPostsAreNotReanalyzed: boolean; incrementalSearchStrategy: string };
  app: { configured: boolean; oauth2Configured: boolean; consumerCredentialsConfigured: boolean; bearerTokenConfigured: boolean; credentialVersion: number; updatedAt: string | null; billing: { status: 'ready' | 'credits_depleted' | 'checking_credits' | 'unknown'; problemType: string | null; checkedAt: string | null } };
  connections: XConnection[]; selectedConnectionId: string | null; connection: XConnection | null;
  queries: XListeningQuery[]; syncJobs: XSyncJob[];
  counts: { collected: number; accountPosts: number; mentions: number; searchResults: number; analyzed: number };
  aggregateCounts: { collected: number; accountPosts: number; mentions: number; searchResults: number; analyzed: number };
}
export interface SocialReplyDraft { id: string; mentionId: string; connectionId: string | null; tone: string; instructions: string; state: 'queued' | 'ready' | 'edited' | 'archived' | 'failed'; generatedContent: string; content: string; rationale: string; safetyFlags: string[]; runtime: any; aiJobId: string; error: string | null; createdAt: string; completedAt: string | null; updatedAt: string }
export interface SocialIntelligenceReport { id: string; connectionId: string | null; title: string; mentionIds: string[]; knowledgeBaseIds: string[]; state: 'queued' | 'completed' | 'failed'; result: any; runtime: any; aiJobId: string; error: string | null; createdAt: string; completedAt: string | null; updatedAt: string }
export interface IntelligenceSource { ref: string; type: 'survey' | 'social'; title: string; kind: string; createdAt: string; preview: string }
export interface IntelligenceReport { id: string; title: string; objective: string; sourceRefs: { survey: string[]; social: string[] }; knowledgeBaseIds: string[]; state: 'queued' | 'completed' | 'failed'; result: any; runtime: any; aiJobId: string; error: string | null; createdAt: string; completedAt: string | null; updatedAt: string }
export interface AssistantConnection {
  id: string; email: string; provider: 'google' | 'microsoft' | string; status: 'connected' | 'degraded' | 'disconnected' | string;
  displayName?: string | null; scopes?: string[]; lastHealthAt?: string | null; lastError?: string | null; createdAt?: string;
}
export interface AssistantThreadParticipant { name?: string | null; email: string }
export interface AssistantThread {
  id: string; subject: string; snippet: string; participants: Array<AssistantThreadParticipant | string>; messageCount: number;
  lastMessageAt: string | null; unread?: boolean;
}
export type AssistantRunKind = 'assistant.email_summary' | 'assistant.email_draft' | 'assistant.knowledge_answer' | 'email_summary' | 'email_draft' | 'knowledge_answer';
export interface AssistantDraft {
  subject: string; body: string; generatedSubject?: string; generatedBody?: string; revision: number; updatedAt?: string;
}
export interface AssistantOutput {
  summary?: string; answer?: string; subject?: string; body?: string; rationale?: string;
  keyPoints?: unknown[]; actionItems?: unknown[]; openQuestions?: unknown[]; safetyFlags?: string[];
  citations?: Array<{ sourceRef: string; excerpt: string }>;
  limitations?: unknown[]; caveats?: unknown[];
}
export interface AssistantRuntime {
  id?: string; provider?: string; providerLabel?: string; engine?: string; model?: string;
  usage?: { totalTokens?: number; total_tokens?: number; [key: string]: unknown };
  latencyMs?: number; queueWaitMs?: number;
}
export interface AssistantRun {
  id: string; jobId: string; kind: AssistantRunKind; state: 'queued' | 'processing' | 'completed' | 'failed';
  stage: string; progress: number; attempt?: number; connectionId?: string | null; subjectRef?: string | null; sourceRefs?: string[];
  output?: AssistantOutput | null; runtime?: AssistantRuntime | null; draft?: AssistantDraft | null;
  generatedDraft?: Pick<AssistantDraft, 'subject' | 'body'> | null; advisoryOnly?: boolean; externalDispatched?: boolean;
  error: string | null; createdAt: string; startedAt?: string | null; completedAt: string | null; updatedAt: string;
}
export interface AssistantOverview {
  configured: boolean; callbackUrl?: string; configurationError?: string | null; connections: AssistantConnection[];
  worker?: { running: boolean; active: number; queued: number; concurrency: number };
  terra?: { ready: boolean; providerLabel?: string; model?: string; error?: string | null };
}
export type KnowledgeBasePrivacy = 'private' | 'space';
export type KnowledgeBaseState = 'empty' | 'indexing' | 'ready' | 'degraded' | 'failed' | 'deleting';
export interface KnowledgeBase {
  id: string; name: string; description: string; privacy: KnowledgeBasePrivacy; terraContextEnabled: boolean;
  state: KnowledgeBaseState; documentCount: number; readyDocumentCount: number; chunkCount: number;
  entityCount: number; relationshipCount: number; storageBytes: number; createdBy?: string | null;
  embeddingProfile?: { provider: 'qwen-tei' | 'gte-node'; model: string; revision: string; dtype: string; dimensions: number; vectorIndexVersion: string };
  createdAt: string; updatedAt: string; lastIndexedAt: string | null;
}
export type KnowledgeDocumentState = 'queued' | 'extracting' | 'indexing' | 'chunking' | 'embedding' | 'ready' | 'failed' | 'deleting' | 'deleted';
export interface KnowledgeBaseDocument {
  id: string; knowledgeBaseId: string; name: string; mimeType: string; size: number; state: KnowledgeDocumentState;
  progress: number; pageCount: number | null; chunkCount: number; entityCount: number; error: string | null;
  createdAt: string; updatedAt: string; indexedAt: string | null;
}
export type KnowledgeIndexingJobState = 'queued' | 'processing' | 'waiting_for_terra' | 'completed' | 'failed' | 'cancelled';
export interface KnowledgeIndexingJob {
  id: string; knowledgeBaseId: string; documentId: string | null; documentName?: string | null;
  state: KnowledgeIndexingJobState; stage: string; progress: number; attempt: number; error: string | null;
  createdAt: string; startedAt: string | null; completedAt: string | null; updatedAt: string;
}
export interface KnowledgeCitation {
  id?: string; sourceRef?: string; knowledgeBaseId?: string; documentId: string; documentName: string; page: number | null; chunkId?: string | null;
  excerpt: string; score?: number | null; section?: string | null;
}
export interface KnowledgeSearchMatch extends KnowledgeCitation { text?: string; metadata?: Record<string, unknown> }
export interface KnowledgeSearchResult {
  query: string; answer: string | null; citations: KnowledgeCitation[]; matches: KnowledgeSearchMatch[];
  tookMs?: number; runtime?: Record<string, unknown> | null;
}
export interface KnowledgeGraphNode {
  id: string; label: string; kind: string; documentIds?: string[]; mentions?: number; metadata?: Record<string, unknown>;
}
export interface KnowledgeGraphEdge {
  id: string; source: string; target: string; label: string; confidence?: number | null;
  documentId?: string | null; documentName?: string | null; page?: number | null; excerpt?: string | null;
}
export interface KnowledgeGraph {
  stats: { documents: number; chunks: number; entities: number; relationships: number };
  nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[]; updatedAt: string | null;
}
export interface JourneyStage { name: string; goal: string; touchpoints: string[]; customerActions: string[]; emotions: string[]; painPoints: string[]; metrics: string[]; opportunities: string[]; recommendedActions: string[] }
export interface JourneyProvenance {
  origin: 'workspace' | 'terra' | 'legacy';
  lastModifiedBy: 'workspace' | 'terra' | 'unknown';
  evidenceBasis: 'brief_only' | 'workspace_authored' | 'knowledge_grounded' | 'unknown';
  evidenceLevel: 'hypothesis';
  generatedAt: string | null;
  optimizedAt: string | null;
}
export interface Journey {
  id: string; name: string; audience: string; objective: string; industry: string; stages: JourneyStage[]; summary: string;
  createdAt: string; updatedAt: string; provenance?: JourneyProvenance;
}
export interface JourneyVersion {
  id: string; journeyId: string; reason: 'workspace_edit' | 'terra_optimize' | 'restore_displaced';
  actor: 'workspace' | 'terra'; sourceJobId: string | null; name: string; stageCount: number;
  snapshotUpdatedAt: string; createdAt: string;
}
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';
export interface Campaign {
  id: string; surveyId: string; collectorId: string; name: string; senderName: string; senderEmail: string; status: CampaignStatus;
  startsAt: string | null; settings: { stopOnResponse?: boolean; [key: string]: any };
  createdAt: string; updatedAt: string; launchedAt: string | null;
  surveyTitle?: string; contactCount?: number; sentCount?: number; failedCount?: number; respondedCount?: number; queuedCount?: number;
}
export interface CampaignStep {
  id: string; campaignId: string; position: number; delayMinutes: number; subject: string;
  mode: 'plain' | 'html'; bodyText: string; bodyHtml: string; embedQuestionId: string | null;
  createdAt?: string; updatedAt?: string;
}
export interface CampaignContact {
  id: string; campaignId: string; recipientId: string; email: string; firstName: string; lastName: string;
  jobTitle: string; company: string; status: 'pending' | 'active' | 'completed' | 'responded' | 'unsubscribed' | 'suppressed' | 'failed';
  currentStep: number; nextSendAt: string | null; customData: Record<string, any>; createdAt: string; updatedAt: string;
}
export interface CampaignDelivery {
  id: string; campaignId: string; contactId: string; stepId: string; stepPosition: number;
  state: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'; attempt: number; scheduledAt: string;
  sentAt: string | null; messageId: string | null; error: string | null; email?: string; subject?: string; updatedAt: string;
  providerStatus?: string | null; providerUpdatedAt?: string | null; deliveredAt?: string | null; openedAt?: string | null;
  clickedAt?: string | null; bouncedAt?: string | null; complainedAt?: string | null; unsubscribedAt?: string | null;
}
export interface CampaignMetrics {
  contacts: number; queued: number; sent: number; failed: number; skipped: number; responded: number; completed: number;
  totalContacts?: number; totalDeliveries?: number; responseRate?: number; lastActivityAt?: string | null;
}
export type CampaignWorkflowSectionKey = 'setup' | 'audience' | 'sequence' | 'schedule';
export interface CampaignWorkflowSection { key: CampaignWorkflowSectionKey; complete: boolean; issues: string[] }
export interface CampaignReadiness {
  ready: boolean; completedSections: number; totalSections: number;
  sections: Record<CampaignWorkflowSectionKey, CampaignWorkflowSection>; issues: string[];
}
export interface CampaignDetail {
  campaign: Campaign; survey: Survey; collector: Collector; steps: CampaignStep[]; contacts: CampaignContact[];
  deliveries: CampaignDelivery[]; metrics: CampaignMetrics; readiness: CampaignReadiness;
}
export interface CampaignTemplate {
  id: string; name: string; description: string;
  subject: string; bodyText: string; bodyHtml: string; mode: 'plain' | 'html';
  steps?: Array<Pick<CampaignStep, 'delayMinutes' | 'subject' | 'mode' | 'bodyText' | 'bodyHtml' | 'embedQuestionId'>>;
}

export type ESignEnvelopeStatus = 'draft' | 'sent' | 'in_progress' | 'finalizing' | 'completed' | 'declined' | 'voided' | 'expired' | 'failed';
export type ESignRecipientRole = 'signer' | 'approver' | 'cc' | 'viewer';
export type ESignRecipientStatus = 'pending' | 'waiting' | 'ready' | 'sent' | 'viewed' | 'in_progress' | 'completed' | 'notified' | 'declined' | 'delivery_failed';
export type ESignFieldType = 'signature' | 'initials' | 'name' | 'email' | 'date_signed' | 'text' | 'checkbox' | 'radio' | 'dropdown';
export type ESignSignatureMode = 'typed' | 'drawn' | 'uploaded';
export type ESignSignatureValue = {
  mode: ESignSignatureMode; value?: string; dataUrl?: string;
  displayText?: string | null; previewUrl?: string | null;
};
export interface ESignSavedSignature {
  id: string; mode: ESignSignatureMode; label: string; mimeType: string | null;
  displayText: string | null; previewUrl: string | null; scope: 'account' | 'recipient'; updatedAt: string;
  canManage?: boolean;
}
export interface ESignSignatureLibrary {
  signatures: ESignSavedSignature[];
  identity: { maskedEmail: string; accountLinked: boolean };
  maxSignatures: number;
}

export interface ESignEnvelope {
  id: string; title: string; status: ESignEnvelopeStatus; subject: string; message: string;
  routingMode: 'sequential' | 'parallel'; expiresInDays: number; reminderIntervalHours: number;
  createdAt: string; updatedAt: string; sentAt: string | null; completedAt: string | null; expiresAt?: string | null;
  finalizationAttempt?: number; finalizationRetryAt?: string | null; finalizationError?: string | null;
  documentCount?: number; recipientCount?: number; completedRecipientCount?: number;
}
export interface ESignDocument {
  id: string; envelopeId: string; name: string; mimeType: string; size: number; pageCount: number;
  createdAt: string; contentUrl?: string;
}
export interface ESignRecipient {
  id: string; envelopeId: string; name: string; email: string; role: ESignRecipientRole; routingOrder: number;
  status: ESignRecipientStatus; accessCodeSet: boolean; requiresAccessCode?: boolean; sentAt?: string | null; viewedAt?: string | null;
  completedAt?: string | null; declinedAt?: string | null;
}
export interface ESignField {
  id: string; envelopeId: string; documentId: string; recipientId: string; type: ESignFieldType;
  page: number; x: number; y: number; width: number; height: number; required: boolean;
  label: string; placeholder: string; options: string[]; value?: string | boolean | string[] | ESignSignatureValue | null; hasValue?: boolean;
  signaturePreview?: { mode: ESignSignatureMode; displayText: string | null; previewUrl: string | null } | null;
}
export interface ESignArtifact {
  id: string; envelopeId: string; kind: 'completed_document' | 'certificate' | string; name: string;
  mimeType: string; size?: number; sha256?: string; fileName?: string; certificateId?: string | null; publicId?: string | null; createdAt: string; contentUrl?: string;
}
export interface ESignAuditEvent {
  id: string; envelopeId: string; sequence?: number; action: string; eventType?: string; actorType?: string; actorName?: string;
  recipientId?: string | null; detail?: string | Record<string, unknown> | null; createdAt: string;
}
export interface ESignEmailDelivery {
  id: string; envelopeId: string; recipientId: string; recipientName: string; recipientEmail: string;
  kind: 'invitation' | 'reminder' | 'completed' | 'voided' | string; state: string; attempts: number;
  scheduledAt: string; providerMessageId: string | null; providerStatus: string | null; providerUpdatedAt: string | null;
  deliveredAt: string | null; openedAt: string | null; bouncedAt: string | null; error: string | null;
  createdAt: string; updatedAt: string; sentAt: string | null;
}
export type ESignWorkflowSectionKey = 'documents' | 'recipients' | 'fields' | 'message';
export interface ESignReadinessSection { key: ESignWorkflowSectionKey; complete: boolean; issues: string[] }
export interface ESignReadiness {
  ready: boolean; completedSections: number; totalSections: number;
  sections: Record<ESignWorkflowSectionKey, ESignReadinessSection>; issues: string[];
}
export interface ESignEnvelopeDetail {
  envelope: ESignEnvelope; documents: ESignDocument[]; recipients: ESignRecipient[]; fields: ESignField[];
  artifacts: ESignArtifact[]; audit: ESignAuditEvent[]; deliveries: ESignEmailDelivery[]; readiness: ESignReadiness;
}
export interface ESignPublicSession {
  recipient: Pick<ESignRecipient, 'id' | 'name' | 'email' | 'role' | 'status'>;
  envelope: Pick<ESignEnvelope, 'id' | 'title' | 'status'>;
  requiresAccessCode: boolean; authenticated: boolean; consented: boolean;
  disclosure: { version: string; text: string; sha256: string };
}
export interface ESignAccountInvitation {
  recipient: { name: string; email: string };
  envelope: Pick<ESignEnvelope, 'id' | 'title' | 'status'>;
  state: 'ready' | 'waiting_for_others';
  signupPath: string; loginPath: string; documentsPath: string;
}
export interface ESignPublicDetail extends ESignPublicSession {
  documents: ESignDocument[]; fields: ESignField[]; artifacts: ESignArtifact[];
  recipients: Array<Pick<ESignRecipient, 'id' | 'name' | 'role' | 'status' | 'completedAt'> & { routingOrder: number }>;
  locked: boolean; canAct: boolean;
  accountOption?: ESignAccountInvitation | null;
}
export interface RecipientDocument {
  id: string; title: string; status: ESignEnvelopeStatus;
  accessState: 'ready' | 'waiting_for_others' | 'finalization_failed';
  sentAt: string | null; signedAt: string | null; completedAt: string | null; updatedAt: string;
  recipient: { name: string; role: ESignRecipientRole; status: ESignRecipientStatus };
  sender: { name: string; spaceName: string };
  artifacts: ESignArtifact[]; activityUrl?: string;
}
export interface RecipientDocumentLibrary {
  documents: RecipientDocument[];
  summary: { total: number; ready: number; waitingForOthers: number; needsAttention: number };
}
export interface RecipientDocumentActivityEvent {
  id: string; eventType: string; createdAt: string; detail: Record<string, unknown>;
}
export interface RecipientDocumentActivity { activity: RecipientDocumentActivityEvent[] }
export interface ESignCertificateVerification {
  valid: boolean; certificateId: string; envelopeId: string; status: ESignEnvelopeStatus;
  completedAt: string | null; documentHash: string; certificateHash: string;
  participants: Array<{ maskedEmail: string; initials?: string; status: string; completedAt: string | null }>;
}

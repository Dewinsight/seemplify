export type OnboardingStatus = "draft" | "pending" | "in_progress" | "completed" | "cancelled"
export type ProcessType = "onboarding" | "exit" | "retirement"
export type EnvelopeStatus = "draft" | "sent" | "viewed" | "partially_signed" | "completed" | "voided" | "expired"
export type WorkflowItemStatus = "not_started" | "pending" | "in_progress" | "completed" | "blocked" | "skipped" | "failed"

export interface CandidateAccount {
  _id: string
  email: string
  profile?: {
    firstName?: string
    lastName?: string
    phone?: string
  }
  status: "invited" | "active" | "disabled"
}

export interface CandidateProfile {
  _id: string
  firstName?: string
  lastName?: string
  email: string
  phone?: string
  position?: string
  status?: string
}

export interface OrganizationSummary {
  _id: string
  name: string
  logo?: string
}

export interface FileSnapshot {
  url?: string
  downloadUrl?: string
  originalName?: string
  mimeType?: string
  renderedAt?: string
}

export interface SignatureField {
  id: string
  role: "candidate" | "internal"
  type: "signature" | "date" | "name" | "email" | "text"
  label?: string
  key?: string
  signerKey?: string
  page: number
  x: number
  y: number
  width: number
  height: number
  required: boolean
}

export interface EnvelopeDocument {
  _id: string
  document: string
  title: string
  status: "pending" | "signed" | "completed" | "voided"
  pdfSnapshot?: FileSnapshot
  signedPdf?: FileSnapshot
  signatureFields: SignatureField[]
  signedAt?: string
}

export interface EnvelopeSigner {
  _id: string
  role: "candidate" | "internal"
  name?: string
  email: string
  order: number
  status: "pending" | "viewed" | "signed" | "declined"
  viewedAt?: string
  signedAt?: string
}

export interface OnboardingEnvelope {
  _id: string
  title: string
  message?: string
  status: EnvelopeStatus
  documents: EnvelopeDocument[]
  signers: EnvelopeSigner[]
  sentAt?: string
  completedAt?: string
  voidedAt?: string
  createdAt: string
  updatedAt: string
}

export interface OnboardingWorkflowItem {
  _id: string
  type: "document" | "form" | "task" | "approval" | "handoff"
  title: string
  description?: string
  status: WorkflowItemStatus
  ownerType: "candidate" | "user" | "system"
  order: number
  dueAt?: string
  sourceType?: string
  sourceId?: string
  lastReminderAt?: string
  completedAt?: string
}

export interface OnboardingFormField {
  id: string
  key: string
  label: string
  type: "text" | "textarea" | "email" | "phone" | "date" | "number" | "select" | "checkbox" | "bank_account" | "routing_number" | "tax_id" | "address" | "file"
  required?: boolean
  sensitive?: boolean
  options?: string[]
  placeholder?: string
  helpText?: string
  order?: number
}

export interface OnboardingFormValue {
  fieldId: string
  key: string
  label: string
  type: string
  sensitive: boolean
  value?: string | number | boolean | string[]
  revealedValue?: string | number | boolean | string[]
  valuePreview?: string
  files?: FileSnapshot[]
  updatedAt?: string
}

export interface OnboardingFormSubmission {
  _id: string
  title: string
  status: "draft" | "submitted" | "under_review" | "approved" | "rejected"
  templateSnapshot?: {
    fields?: OnboardingFormField[]
  }
  values: OnboardingFormValue[]
  hasSensitiveValues: boolean
  submittedAt?: string
  reviewedAt?: string
  reviewerNotes?: string
  rejectionReason?: string
}

export interface OnboardingApproval {
  _id: string
  type: "sensitive_data" | "exception" | "completion"
  status: "pending" | "approved" | "rejected" | "cancelled"
  formSubmission?: string
  notes?: string
  reviewedAt?: string
}

export interface OnboardingHandoff {
  _id: string
  target: "internal_employee_profile" | "exit_closeout" | "retirement_closeout" | "payroll" | "identity_provider" | "custom"
  status: "pending" | "running" | "completed" | "failed"
  attempts: number
  lastError?: string
  completedAt?: string
}

export interface CandidateOnboarding {
  _id: string
  title: string
  processType?: ProcessType
  status: OnboardingStatus
  notes?: string
  candidate: CandidateProfile
  organization?: OrganizationSummary
  envelopes?: OnboardingEnvelope[]
  workflowItems?: OnboardingWorkflowItem[]
  forms?: OnboardingFormSubmission[]
  approvals?: OnboardingApproval[]
  handoffs?: OnboardingHandoff[]
  progress?: {
    totalItems: number
    completedItems: number
    percent: number
  }
  startedAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CandidateDocumentPayload {
  envelope: OnboardingEnvelope
  document: EnvelopeDocument
  signer?: EnvelopeSigner
  canSign: boolean
  nextDocumentId?: string | null
  downloadUrl?: string
}

export interface AuthResponse {
  token: string
  refreshToken: string
  expiresIn: string
  account: CandidateAccount
}

export type OnboardingStatus = "draft" | "pending" | "in_progress" | "completed" | "cancelled"
export type EnvelopeStatus = "draft" | "sent" | "viewed" | "partially_signed" | "completed" | "voided" | "expired"

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

export interface CandidateOnboarding {
  _id: string
  title: string
  status: OnboardingStatus
  notes?: string
  candidate: CandidateProfile
  organization?: OrganizationSummary
  envelopes?: OnboardingEnvelope[]
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
  downloadUrl?: string
}

export interface AuthResponse {
  token: string
  refreshToken: string
  expiresIn: string
  account: CandidateAccount
}

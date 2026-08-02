import type { CandidateNextAction, CandidateOnboarding, EnvelopeDocument, OnboardingEnvelope, OnboardingFormSubmission, OnboardingWorkflowItem } from "@/lib/types"

export type TransitionFlowStepType = "form" | "document_fill" | "document_sign" | "waiting" | "complete"

export interface TransitionFlowStep {
  id: string
  type: TransitionFlowStepType
  label: string
  href: string
  status: string
  meta?: string
  dueAt?: string
  actionable: boolean
  disabled?: boolean
}

const ACTIVE_ENVELOPE_STATUSES = new Set(["sent", "viewed", "partially_signed"])

function idOf(value: unknown) {
  if (!value) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && "_id" in value && (value as { _id?: unknown })._id) {
    return String((value as { _id: unknown })._id)
  }
  return String(value)
}

function formActionable(form: OnboardingFormSubmission) {
  return form.status === "draft" || form.status === "rejected"
}

function documentComplete(document: EnvelopeDocument) {
  return document.status === "completed" || document.status === "signed"
}

function candidateSignerCanAct(envelope: OnboardingEnvelope) {
  const candidateSigner = (envelope.signers || []).find((signer) => signer.role === "candidate")
  if (!candidateSigner || candidateSigner.status === "signed") return false
  return !(envelope.signers || []).some((signer) => Number(signer.order || 1) < Number(candidateSigner.order || 1) && signer.status !== "signed")
}

const FILL_ONLY_FIELD_TYPES = new Set(["text", "image", "name", "email", "date"])

function documentCandidateActionType(document: EnvelopeDocument): "document_fill" | "document_sign" | null {
  const candidateFields = (document.signatureFields || []).filter((field) => (field.role || "candidate") === "candidate")
  const hasSignature = candidateFields.some((field) => field.type === "signature")
  const hasFillField = candidateFields.some((field) => FILL_ONLY_FIELD_TYPES.has(field.type))
  if (hasFillField && !hasSignature) return "document_fill"
  if (hasSignature) return "document_sign"
  return null
}

function documentStepType(document: EnvelopeDocument): TransitionFlowStepType {
  return documentCandidateActionType(document) || "document_sign"
}

function documentActionable(envelope: OnboardingEnvelope, document: EnvelopeDocument) {
  return document.status === "pending" &&
    Boolean(documentCandidateActionType(document)) &&
    ACTIVE_ENVELOPE_STATUSES.has(envelope.status) &&
    candidateSignerCanAct(envelope)
}

function formStep(form: OnboardingFormSubmission, item?: OnboardingWorkflowItem): TransitionFlowStep {
  const actionable = formActionable(form)
  return {
    id: `form:${form._id}`,
    type: "form",
    label: form.status === "rejected" ? `Update ${form.title}` : form.title,
    href: `/forms/${form._id}`,
    status: form.status,
    meta: "Form",
    dueAt: item?.dueAt,
    actionable,
  }
}

function documentStep(envelope: OnboardingEnvelope, document: EnvelopeDocument, item?: OnboardingWorkflowItem): TransitionFlowStep {
  const type = documentStepType(document)
  const actionable = documentActionable(envelope, document)
  return {
    id: `document:${document._id}`,
    type,
    label: document.title,
    href: documentComplete(document) ? `/documents/${document._id}/download` : `/documents/${document._id}/sign`,
    status: document.status,
    meta: type === "document_fill" ? "Fillable document" : "Signature document",
    dueAt: item?.dueAt,
    actionable,
    disabled: !documentComplete(document) && !actionable,
  }
}

function waitingStep(record: CandidateOnboarding, item: OnboardingWorkflowItem): TransitionFlowStep {
  return {
    id: `workflow:${item._id}`,
    type: "waiting",
    label: item.title,
    href: `/transitions/${record._id}`,
    status: item.status,
    meta: item.ownerType === "candidate" ? "Candidate task" : "Internal task",
    dueAt: item.dueAt,
    actionable: false,
    disabled: item.ownerType !== "candidate",
  }
}

export function buildTransitionFlow(record?: CandidateOnboarding | null): TransitionFlowStep[] {
  if (!record) return []

  const steps: TransitionFlowStep[] = []
  const formsById = new Map((record.forms || []).map((form) => [form._id, form]))
  const envelopesById = new Map((record.envelopes || []).map((envelope) => [envelope._id, envelope]))
  const usedForms = new Set<string>()
  const usedEnvelopes = new Set<string>()
  const sortedItems = [...(record.workflowItems || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))

  for (const item of sortedItems) {
    const sourceId = idOf(item.sourceId)
    if (item.type === "form") {
      const form = formsById.get(sourceId)
      if (form) {
        steps.push(formStep(form, item))
        usedForms.add(form._id)
      } else {
        steps.push(waitingStep(record, item))
      }
      continue
    }

    if (item.type === "document") {
      const matchingEnvelopes = sourceId && envelopesById.has(sourceId)
        ? [envelopesById.get(sourceId)!]
        : (record.envelopes || []).filter((envelope) => !usedEnvelopes.has(envelope._id))
      for (const envelope of matchingEnvelopes) {
        usedEnvelopes.add(envelope._id)
        for (const document of envelope.documents || []) {
          steps.push(documentStep(envelope, document, item))
        }
      }
      continue
    }

    if (item.required !== false) {
      steps.push(waitingStep(record, item))
    }
  }

  for (const form of record.forms || []) {
    if (!usedForms.has(form._id)) steps.push(formStep(form))
  }

  for (const envelope of record.envelopes || []) {
    if (usedEnvelopes.has(envelope._id)) continue
    for (const document of envelope.documents || []) {
      steps.push(documentStep(envelope, document))
    }
  }

  if (record.status === "completed") {
    steps.push({
      id: `complete:${record._id}`,
      type: "complete",
      label: "Transition complete",
      href: `/transitions/${record._id}`,
      status: record.status,
      meta: "Complete",
      actionable: false,
    })
  }

  return steps
}

export function transitionActionHref(
  transition?: CandidateOnboarding | null,
  fallbackHref = "/dashboard",
) {
  const action: CandidateNextAction | undefined = transition?.nextAction
  if (!action) return fallbackHref
  if (action.type === "waiting" || action.type === "complete") {
    return `/transitions/${action.recordId || transition?._id}`
  }
  return action.href
}

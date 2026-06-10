import type { CandidateOnboarding } from "@/lib/types"

// Human label for a transition, considering both the content axis (workflowType,
// absorbed from the retired IdP onboarding feature) and the life-event axis
// (processType). Replaces the three duplicated processLabel helpers.
export function transitionLabel(record?: CandidateOnboarding | null): string {
  const workflowType = record?.workflowType || "onboarding"
  if (workflowType === "agreement") return "Agreement"
  if (workflowType === "policy") return "Policy acknowledgement"
  if (workflowType === "general") return "Workflow"

  const processType = record?.processType || "onboarding"
  if (processType === "exit") return "Exit"
  if (processType === "retirement") return "Retirement"
  return "Onboarding"
}

// Noun for the subject of a transition, audience-aware (internal employees vs
// external candidates).
export function subjectNoun(record?: CandidateOnboarding | null): string {
  return record?.audience === "internal" ? "employee" : "candidate"
}

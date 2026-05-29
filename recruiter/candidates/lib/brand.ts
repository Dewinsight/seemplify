export type CandidateBrandId = "seemplify" | "akwa-ibom"

export interface CandidateBrand {
  id: CandidateBrandId
  portalName: string
  organizationName: string
  shortName: string
  logoUrl?: string
  metaTitle: string
  metaDescription: string
  loginEyebrow: string
  loginHeading: string
  loginDescription: string
  signupEyebrow: string
  dashboardEyebrow: string
  accentTextClass: string
  accentBgClass: string
  accentBorderClass: string
  focusRingClass: string
  primaryButtonClass: string
  softGradientClass: string
  sidebarClass: string
  navActiveClass: string
  progressClass: string
}

export const CANDIDATE_BRANDS: Record<CandidateBrandId, CandidateBrand> = {
  seemplify: {
    id: "seemplify",
    portalName: "Seemplify Candidate Portal",
    organizationName: "Seemplify",
    shortName: "S",
    metaTitle: "Seemplify Candidate Portal",
    metaDescription: "Candidate onboarding, signing, and document downloads",
    loginEyebrow: "Seemplify Candidate Portal",
    loginHeading: "Review, sign, and keep your onboarding documents.",
    loginDescription:
      "Your recruiter sends the packet. You complete it here with a separate candidate login, even if you also use Seemplify elsewhere.",
    signupEyebrow: "Candidate invitation",
    dashboardEyebrow: "Seemplify",
    accentTextClass: "text-blue-700",
    accentBgClass: "bg-blue-50",
    accentBorderClass: "border-blue-200",
    focusRingClass: "ring-blue-500",
    primaryButtonClass: "bg-slate-950 hover:bg-slate-800",
    softGradientClass: "from-blue-50 via-white to-emerald-50",
    sidebarClass: "border-slate-200 bg-white/92",
    navActiveClass: "bg-slate-950 text-white",
    progressClass: "bg-blue-600",
  },
  "akwa-ibom": {
    id: "akwa-ibom",
    portalName: "Akwa Ibom Candidate Portal",
    organizationName: "Government of Akwa Ibom State",
    shortName: "AKS",
    logoUrl: "https://ibom.aiinnigeria.com/logoakwa.png",
    metaTitle: "Akwa Ibom Candidate Portal",
    metaDescription: "Akwa Ibom State candidate onboarding, signing, and document downloads",
    loginEyebrow: "Akwa Ibom Candidate Portal",
    loginHeading: "Review, sign, and keep your Akwa Ibom onboarding documents.",
    loginDescription:
      "Complete onboarding documentation sent by the Government of Akwa Ibom State recruitment team using a dedicated candidate login.",
    signupEyebrow: "Akwa Ibom candidate invitation",
    dashboardEyebrow: "Akwa Ibom State",
    accentTextClass: "text-emerald-800",
    accentBgClass: "bg-emerald-50",
    accentBorderClass: "border-emerald-200",
    focusRingClass: "ring-emerald-600",
    primaryButtonClass: "bg-emerald-900 hover:bg-emerald-800",
    softGradientClass: "from-emerald-50 via-white to-amber-50",
    sidebarClass: "border-emerald-900/10 bg-white/94",
    navActiveClass: "bg-emerald-900 text-white",
    progressClass: "bg-emerald-700",
  },
}

export function detectCandidateBrandFromHostname(hostname?: string | null): CandidateBrand {
  const host = String(hostname || "").toLowerCase()

  if (
    host.includes("candidate-ibom.aiinnigeria.com") ||
    host.includes("candidate-ibom-dev.aiinnigeria.com") ||
    host.includes("candidate.ibom.aiinnigeria.com") ||
    host.includes("candidate-dev.ibom.aiinnigeria.com") ||
    host.includes("ibom.aiinnigeria.com") ||
    host.includes("akwaibom.aiinnigeria.com") ||
    host.includes("akwa.aiinnigeria.com") ||
    host.includes("jetstone.aiinnigeria.com")
  ) {
    return CANDIDATE_BRANDS["akwa-ibom"]
  }

  return CANDIDATE_BRANDS.seemplify
}

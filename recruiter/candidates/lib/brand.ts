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
  canvasClass: string
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
    metaDescription: "Candidate transition, signing, and document downloads",
    loginEyebrow: "Seemplify Candidate Portal",
    loginHeading: "Review, sign, and keep your transition documents.",
    loginDescription:
      "Your recruiter sends the packet. You complete it here with a separate candidate login, even if you also use Seemplify elsewhere.",
    signupEyebrow: "Candidate invitation",
    dashboardEyebrow: "Seemplify",
    accentTextClass: "text-[#7047eb]",
    accentBgClass: "bg-[#f1edff]",
    accentBorderClass: "border-[#d9cffb]",
    focusRingClass: "ring-[#7047eb]",
    primaryButtonClass: "bg-[#191816] hover:bg-[#302d38]",
    canvasClass: "bg-[#f1efe9]",
    sidebarClass: "border-[#ddd8ce] bg-[#fffdfa]",
    navActiveClass: "bg-[#f1edff] text-[#5f37d7] shadow-[inset_0_0_0_1px_#d9cffb]",
    progressClass: "bg-[#7047eb]",
  },
  "akwa-ibom": {
    id: "akwa-ibom",
    portalName: "Akwa Ibom Candidate Portal",
    organizationName: "Government of Akwa Ibom State",
    shortName: "AKS",
    logoUrl: "https://ibom.aiinnigeria.com/logoakwa.png",
    metaTitle: "Akwa Ibom Candidate Portal",
    metaDescription: "Akwa Ibom State candidate transition, signing, and document downloads",
    loginEyebrow: "Akwa Ibom Candidate Portal",
    loginHeading: "Review, sign, and keep your Akwa Ibom transition documents.",
    loginDescription:
      "Complete transition documentation sent by the Government of Akwa Ibom State recruitment team using a dedicated candidate login.",
    signupEyebrow: "Akwa Ibom candidate invitation",
    dashboardEyebrow: "Akwa Ibom State",
    accentTextClass: "text-emerald-800",
    accentBgClass: "bg-emerald-50",
    accentBorderClass: "border-emerald-200",
    focusRingClass: "ring-emerald-600",
    primaryButtonClass: "bg-emerald-900 hover:bg-emerald-800",
    canvasClass: "bg-[#f4f7f3]",
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

export const siteConfig = {
  name: 'Seemplify',
  shortName: 'Seemplify',
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'https://seemplifyai.com').replace(/\/$/, ''),
  idpBaseUrl: (process.env.NEXT_PUBLIC_IDP_BASE_URL || 'https://auth.seemplifyai.com').replace(/\/$/, ''),
  /** Recruiter has its own marketing site; product links hand off to it. */
  recruiterSiteUrl: (process.env.NEXT_PUBLIC_RECRUITER_SITE_URL || 'https://app.seemplifyai.com').replace(/\/$/, ''),
  title: 'AI-Powered People Operations | Seemplify',
  description:
    'Seemplify connects recruiting, onboarding, leave, performance, time, payroll, experience and learning, with ChatGPT or Local AI where teams choose to use it.',
  ogImage: '/opengraph-image',
  contactEmail: 'michael.egbo@aiinnigeria.com',
  keywords: [
    'people operations platform',
    'AI recruiting software',
    'employee onboarding software',
    'leave management software',
    'performance management software',
    'time and attendance software',
    'payroll operations software',
    'employee experience platform',
    'learning management software',
    'HR software Africa',
  ],
} as const

export const akwaIbomConfig = {
  name: 'Akwa Ibom State',
  shortName: 'AKS',
  url: 'https://akwaibom.aiinnigeria.com',
  idpBaseUrl: 'https://akwa.aiinnigeria.com',
  appUrl: 'https://ibom.aiinnigeria.com',
  recruiterSiteUrl: 'https://ibom.aiinnigeria.com',
  title: 'Akwa Ibom State — Human Resource Management Portal',
  description: 'Official Akwa Ibom State government Human Resource Management Portal. Fair, transparent public-sector hiring.',
  ogImage: '/opengraph-image',
  contactEmail: 'recruitment@akwaibomstate.gov.ng',
  keywords: ['Akwa Ibom', 'Human Resource Management', 'Recruitment', 'State Government', 'Nigeria'],
} as const

export function getSiteConfig(host?: string) {
  if (host && (host.includes('akwaibom.aiinnigeria.com') || host.includes('akwaibom'))) {
    return akwaIbomConfig
  }
  return siteConfig
}

export function absoluteUrl(path = '/', host?: string) {
  const config = getSiteConfig(host)
  return new URL(path, `${config.url}/`).toString()
}

export function idpUrl(path = '/', host?: string) {
  const config = getSiteConfig(host)
  return new URL(path, `${config.idpBaseUrl}/`).toString()
}

export const siteConfig = {
  name: 'Seemplify',
  shortName: 'Seemplify',
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'https://seemplifyai.com').replace(/\/$/, ''),
  idpBaseUrl: (process.env.NEXT_PUBLIC_IDP_BASE_URL || 'https://auth.seemplifyai.com').replace(/\/$/, ''),
  title: 'AI Software for Nigeria, Ghana, Kenya & South Africa | Seemplify',
  description:
    'Seemplify is AI software for Nigeria, Ghana, Kenya, South Africa, and English-speaking African teams. Unify recruiting, onboarding, leave, performance, time, and payroll workflows in one platform.',
  ogImage: '/hero-banner-beautiful.png',
  contactEmail: 'michael.egbo@aiinnigeria.com',
  keywords: [
    'AI software Africa',
    'AI software Nigeria',
    'AI software Ghana',
    'AI software Kenya',
    'AI software South Africa',
    'AI business software Africa',
    'AI platform Africa',
    'AI platform Nigeria',
    'AI platform Ghana',
    'AI platform Kenya',
    'AI platform South Africa',
    'team operations software Africa',
    'employee management software Africa',
    'recruitment software Africa',
    'leave management software Africa',
    'performance management software Africa',
    'payroll software Africa',
    'AI workflow automation Africa',
    'AI software for African companies',
  ],
} as const

export const akwaIbomConfig = {
  name: 'Akwa Ibom State',
  shortName: 'AKS',
  url: 'https://akwaibom.aiinnigeria.com',
  idpBaseUrl: 'https://akwa.aiinnigeria.com',
  appUrl: 'https://ibom.aiinnigeria.com',
  title: 'Akwa Ibom State — Human Resource Management Portal',
  description: 'Official Akwa Ibom State government Human Resource Management Portal. Fair, transparent public-sector hiring.',
  ogImage: '/logoakwa.png',
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

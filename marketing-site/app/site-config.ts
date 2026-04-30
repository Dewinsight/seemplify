export const siteConfig = {
  name: 'Seemplify',
  shortName: 'Seemplify',
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'https://seemplifyai.com').replace(/\/$/, ''),
  idpBaseUrl: (process.env.NEXT_PUBLIC_IDP_BASE_URL || 'https://auth.seemplifyai.com').replace(/\/$/, ''),
  title: 'HR Software for Nigeria, Ghana, Kenya & South Africa | Seemplify',
  description:
    'Seemplify is AI HR software for Nigeria, Ghana, Kenya, South Africa, and English-speaking African teams. Unify recruiting, onboarding, leave, performance, time, and payroll workflows in one platform.',
  ogImage: '/hero-banner-beautiful.png',
  contactEmail: 'michael.egbo@aiinnigeria.com',
  keywords: [
    'HR software Africa',
    'HR software Nigeria',
    'HR software Ghana',
    'HR software Kenya',
    'HR software South Africa',
    'HR management software Africa',
    'HRIS Africa',
    'HRIS Nigeria',
    'HRIS Ghana',
    'HRIS Kenya',
    'HRIS South Africa',
    'people operations software Africa',
    'employee management software Africa',
    'recruitment software Africa',
    'leave management software Africa',
    'performance management software Africa',
    'payroll software Africa',
    'AI HR software Africa',
    'HR platform for African companies',
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

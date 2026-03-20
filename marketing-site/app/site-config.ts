export const siteConfig = {
  name: 'Seemplify',
  shortName: 'Seemplify',
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'https://seemplifyai.com').replace(/\/$/, ''),
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

export function absoluteUrl(path = '/') {
  return new URL(path, `${siteConfig.url}/`).toString()
}

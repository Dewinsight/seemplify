const normalizeHost = (hostname) => String(hostname || '').trim().toLowerCase()

export const resolveBranding = (hostname) => {
  const normalizedHost = normalizeHost(hostname)
  const isAiinNigeria = normalizedHost.includes('aiinnigeria.com')

  const brandKey = isAiinNigeria ? 'aiin' : 'seemplify'
  const brandName = isAiinNigeria ? 'AIIN Nigeria' : 'Seemplify'
  const learningName = `${brandName} Learning`

  return {
    brandKey,
    brandName,
    learningName,
    teachLabel: `Teach on ${brandName}`
  }
}

export const resolveTeachBrand = (hostname) => resolveBranding(hostname).brandName

export const resolveTeachLabel = (hostname) => resolveBranding(hostname).teachLabel

export default resolveBranding

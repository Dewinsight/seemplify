describe('IDP subscription service routing', () => {
  const originalEnv = { ...process.env }
  const originalFetch = global.fetch

  afterEach(() => {
    process.env = { ...originalEnv }
    global.fetch = originalFetch
    jest.restoreAllMocks()
    jest.resetModules()
  })

  test('uses the internal Identity URL for verification and the public URL for recovery', async () => {
    process.env.IDP_INTERNAL_API_URL = 'http://identity-provider:5008/'
    process.env.IDP_ISSUER_URL = 'https://auth.seemplifyai.com/'
    delete process.env.IDP_URL
    delete process.env.IDP_PUBLIC_URL

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        hasSubscription: true,
        status: 'active',
        planName: 'Starter',
        features: { leaveManagement: true },
        limits: {}
      })
    }))

    const service = require('../services/idpSubscriptionService')
    const result = await service.verifySubscriptionAccess('org-123', 'access-token')

    expect(result.allowed).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://identity-provider:5008/api/organizations/org-123/subscription/verify',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Cache-Control': 'no-store'
        })
      })
    )
    expect(service.getSubscriptionRequiredUrl('leave-management', 'org-123', 'verification_failed'))
      .toBe('https://auth.seemplifyai.com/subscription-required?app=leave-management&org=org-123&reason=verification_failed')
  })

  test('falls back to the public issuer when no internal URL is configured', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.IDP_INTERNAL_API_URL
    delete process.env.IDP_URL
    delete process.env.IDP_PUBLIC_URL
    process.env.IDP_ISSUER_URL = 'https://auth.seemplifyai.com/'

    global.fetch = jest.fn(async () => ({ ok: false, status: 401 }))

    const service = require('../services/idpSubscriptionService')
    const result = await service.verifySubscriptionAccess('org-456', 'access-token')

    expect(result).toEqual({ allowed: false, reason: 'verification_failed', status: 401 })
    expect(global.fetch).toHaveBeenCalledWith(
      'https://auth.seemplifyai.com/api/organizations/org-456/subscription/verify',
      expect.any(Object)
    )
  })
})

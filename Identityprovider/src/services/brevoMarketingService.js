import { URLSearchParams } from 'url'

class BrevoMarketingService {
  constructor() {
    this.apiKey = process.env.BREVO_API_KEY || ''
    this.apiBase = String(process.env.BREVO_API_BASE_URL || 'https://api.brevo.com/v3').replace(/\/+$/, '')
  }

  isConfigured() {
    return Boolean(this.apiKey)
  }

  async request(path, {
    method = 'GET',
    query,
    body,
    headers = {}
  } = {}) {
    if (!this.apiKey) {
      throw new Error('BREVO_API_KEY is not configured')
    }

    const params = new URLSearchParams()
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      params.set(key, String(value))
    })

    const url = `${this.apiBase}${path}${params.toString() ? `?${params.toString()}` : ''}`
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        'api-key': this.apiKey,
        'content-type': 'application/json',
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

    if (response.status === 204) {
      return null
    }

    const payload = await response.json().catch(async () => {
      const text = await response.text()
      return { message: text }
    })

    if (!response.ok) {
      const message = payload?.message || payload?.code || response.statusText || 'Brevo API request failed'
      const error = new Error(message)
      error.status = response.status
      error.payload = payload
      throw error
    }

    return payload
  }

  async getSenders(query = {}) {
    const response = await this.request('/senders', { query })
    return Array.isArray(response?.senders) ? response.senders : []
  }

  async getDomains() {
    const response = await this.request('/senders/domains')
    return Array.isArray(response?.domains) ? response.domains : []
  }

  async getAttributes() {
    const response = await this.request('/contacts/attributes')
    return Array.isArray(response?.attributes) ? response.attributes : []
  }

  async ensureAttributes(definitions = []) {
    const existing = await this.getAttributes()
    const existingNames = new Set(existing.map((attribute) => `${attribute.category}:${attribute.name}`))

    for (const definition of definitions) {
      const category = definition.category || 'normal'
      const key = `${category}:${definition.name}`
      if (existingNames.has(key)) continue
      await this.request(`/contacts/attributes/${category}/${definition.name}`, {
        method: 'POST',
        body: {
          type: definition.type || 'text'
        }
      })
      existingNames.add(key)
    }
  }

  async getFolders() {
    const response = await this.request('/contacts/folders', {
      query: {
        limit: 50,
        sort: 'desc'
      }
    })
    return Array.isArray(response?.folders) ? response.folders : []
  }

  async ensureFolder(name) {
    const folders = await this.getFolders()
    const match = folders.find((folder) => String(folder.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase())
    if (match) return match

    const created = await this.request('/contacts/folders', {
      method: 'POST',
      body: { name }
    })

    return {
      id: created?.id,
      name
    }
  }

  async getLists() {
    const response = await this.request('/contacts/lists', {
      query: {
        limit: 50,
        sort: 'desc'
      }
    })
    return Array.isArray(response?.lists) ? response.lists : []
  }

  async ensureList({ folderId, name }) {
    const lists = await this.getLists()
    const match = lists.find((list) => (
      String(list.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase() &&
      Number(list.folderId || folderId || 0) === Number(folderId || 0)
    ))
    if (match) return match

    const created = await this.request('/contacts/lists', {
      method: 'POST',
      body: {
        folderId,
        name
      }
    })

    return {
      id: created?.id,
      folderId,
      name
    }
  }

  async upsertContacts({ listId, contacts = [] }) {
    const results = []
    for (const contact of contacts) {
      const payload = {
        email: contact.email,
        listIds: listId ? [listId] : undefined,
        updateEnabled: true,
        attributes: contact.attributes || {}
      }

      const response = await this.request('/contacts', {
        method: 'POST',
        body: payload
      })
      results.push({
        id: response?.id || null,
        email: contact.email
      })
    }
    return results
  }

  async getContact(email) {
    const encodedEmail = encodeURIComponent(email)
    return this.request(`/contacts/${encodedEmail}`)
  }

  async createEmailCampaign(payload) {
    return this.request('/emailCampaigns', {
      method: 'POST',
      body: payload
    })
  }

  async updateEmailCampaign(campaignId, payload) {
    return this.request(`/emailCampaigns/${campaignId}`, {
      method: 'PUT',
      body: payload
    })
  }

  async sendCampaignNow(campaignId) {
    return this.request(`/emailCampaigns/${campaignId}/sendNow`, {
      method: 'POST'
    })
  }

  async sendCampaignTest(campaignId, emailTo = []) {
    return this.request(`/emailCampaigns/${campaignId}/sendTest`, {
      method: 'POST',
      body: emailTo.length > 0 ? { emailTo } : {}
    })
  }

  async getCampaignReport(campaignId) {
    return this.request(`/emailCampaigns/${campaignId}`)
  }

  async getContactStats(identifier, query = {}) {
    const encoded = encodeURIComponent(identifier)
    return this.request(`/contacts/${encoded}/campaignStats`, {
      query
    })
  }

  async getWebhooks() {
    const response = await this.request('/webhooks')
    return Array.isArray(response?.webhooks) ? response.webhooks : []
  }

  async ensureMarketingWebhook({ url, description, secret }) {
    const webhooks = await this.getWebhooks()
    const targetUrl = String(url || '').trim()
    const existing = webhooks.find((webhook) => String(webhook.url || '').trim() === targetUrl)
    if (existing) return existing

    const created = await this.request('/webhooks', {
      method: 'POST',
      body: {
        url: targetUrl,
        description,
        events: ['opened', 'click', 'hardBounce', 'softBounce', 'unsubscribed', 'spam', 'delivered'],
        headers: secret
          ? [{ key: 'x-seemplify-brevo-secret', value: secret }]
          : undefined
      }
    })

    return {
      id: created?.id,
      url: targetUrl,
      description
    }
  }
}

export const brevoMarketingService = new BrevoMarketingService()

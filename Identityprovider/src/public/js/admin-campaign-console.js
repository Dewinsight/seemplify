(function () {
  const boot = window.__CAMPAIGN_CONSOLE__ || {}
  const DEFAULT_AUDIENCE_FIELDS = [
    { key: 'email', label: 'Email', required: true, description: 'Primary recipient email address.' },
    { key: 'firstName', label: 'First Name', description: 'Used for personalization tokens.' },
    { key: 'lastName', label: 'Last Name', description: 'Used for personalization tokens.' },
    { key: 'role', label: 'Role', description: 'Primary role or position label.' },
    { key: 'jobTitle', label: 'Job Title', description: 'Specific job title for the contact.' },
    { key: 'jobLevel', label: 'Job Level', description: 'Seniority or level data.' },
    { key: 'department', label: 'Department', description: 'Department or function.' },
    { key: 'companyName', label: 'Company Name', description: 'Organization name for the recipient.' },
    { key: 'industry', label: 'Industry', description: 'Industry or sector for the company.' },
    { key: 'companyHeadCount', label: 'Company Headcount', description: 'Employee count or size band.' },
    { key: 'location', label: 'Location', description: 'Country, region, or office.' },
    { key: 'companyDescription', label: 'Company Description', description: 'Short description or notes.' },
    { key: 'tailoredMessage', label: 'Tailored Message', description: 'Custom message used for personalization.' }
  ]

  const state = {
    campaigns: Array.isArray(boot.campaigns) ? boot.campaigns : [],
    audiences: Array.isArray(boot.audiences) ? boot.audiences : [],
    templates: Array.isArray(boot.templates) ? boot.templates : [],
    senderHealth: Array.isArray(boot.senderHealth) ? boot.senderHealth : [],
    audienceFields: Array.isArray(boot.audienceFields) && boot.audienceFields.length > 0 ? boot.audienceFields : DEFAULT_AUDIENCE_FIELDS,
    selectedCampaignId: '',
    mode: 'visual',
    draft: null,
    draggingBlockId: '',
    linkRange: null,
    linkHost: null,
    campaignSearch: '',
    campaignStatusFilter: 'all',
    audiencePreview: null
  }

  const els = {
    campaignId: document.getElementById('campaignId'),
    campaignName: document.getElementById('campaignName'),
    campaignAudience: document.getElementById('campaignAudience'),
    senderName: document.getElementById('senderName'),
    senderEmail: document.getElementById('senderEmail'),
    campaignSubject: document.getElementById('campaignSubject'),
    campaignPreviewText: document.getElementById('campaignPreviewText'),
    campaignReplyTo: document.getElementById('campaignReplyTo'),
    campaignBatchSize: document.getElementById('campaignBatchSize'),
    campaignIntervalMinutes: document.getElementById('campaignIntervalMinutes'),
    campaignUtmSource: document.getElementById('campaignUtmSource'),
    campaignUtmMedium: document.getElementById('campaignUtmMedium'),
    campaignUtmCampaign: document.getElementById('campaignUtmCampaign'),
    campaignTemplate: document.getElementById('campaignTemplate'),
    campaignTestEmails: document.getElementById('campaignTestEmails'),
    allowExternalDecoration: document.getElementById('allowExternalDecoration'),
    visualModeBtn: document.getElementById('visualModeBtn'),
    htmlModeBtn: document.getElementById('htmlModeBtn'),
    visualBuilder: document.getElementById('visualBuilder'),
    htmlBuilder: document.getElementById('htmlBuilder'),
    visualPreview: document.getElementById('visualPreview'),
    htmlEditor: document.getElementById('htmlEditor'),
    htmlPreview: document.getElementById('htmlPreview'),
    campaignList: document.getElementById('campaignList'),
    campaignSearchInput: document.getElementById('campaignSearchInput'),
    campaignStatusFilter: document.getElementById('campaignStatusFilter'),
    campaignListSummary: document.getElementById('campaignListSummary'),
    selectedCampaignSummary: document.getElementById('selectedCampaignSummary'),
    audienceList: document.getElementById('audienceList'),
    templateList: document.getElementById('templateList'),
    senderHealthList: document.getElementById('senderHealthList'),
    audienceUploadForm: document.getElementById('audienceUploadForm'),
    audienceName: document.getElementById('audienceName'),
    audienceDescription: document.getElementById('audienceDescription'),
    audienceFile: document.getElementById('audienceFile'),
    audienceSheetGroup: document.getElementById('audienceSheetGroup'),
    audienceSheetSelect: document.getElementById('audienceSheetSelect'),
    audiencePreviewBtn: document.getElementById('audiencePreviewBtn'),
    audienceImportBtn: document.getElementById('audienceImportBtn'),
    audienceResetBtn: document.getElementById('audienceResetBtn'),
    audienceImportStatus: document.getElementById('audienceImportStatus'),
    audienceMappingPanel: document.getElementById('audienceMappingPanel'),
    audienceColumnMapping: document.getElementById('audienceColumnMapping'),
    audiencePreviewMeta: document.getElementById('audiencePreviewMeta'),
    audiencePreviewTable: document.getElementById('audiencePreviewTable'),
    newCampaignBtn: document.getElementById('newCampaignBtn'),
    saveCampaignBtn: document.getElementById('saveCampaignBtn'),
    launchCampaignBtn: document.getElementById('launchCampaignBtn'),
    pauseCampaignBtn: document.getElementById('pauseCampaignBtn'),
    resumeCampaignBtn: document.getElementById('resumeCampaignBtn'),
    cancelCampaignBtn: document.getElementById('cancelCampaignBtn'),
    sendTestBtn: document.getElementById('sendTestBtn'),
    campaignDetailLink: document.getElementById('campaignDetailLink'),
    linkPopover: document.getElementById('linkPopover'),
    linkPopoverInput: document.getElementById('linkPopoverInput'),
    applyLinkBtn: document.getElementById('applyLinkBtn'),
    unlinkSelectionBtn: document.getElementById('unlinkSelectionBtn'),
    campaignStatTotal: document.getElementById('campaignStatTotal'),
    campaignStatAudiences: document.getElementById('campaignStatAudiences'),
    campaignStatTemplates: document.getElementById('campaignStatTemplates'),
    campaignStatHealthySenders: document.getElementById('campaignStatHealthySenders')
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function defaultBlocks() {
    return [
      {
        id: uid('hero'),
        type: 'hero',
        eyebrow: 'Seemplify',
        title: 'One operating system for HR execution.',
        body: 'Run recruiting, onboarding, approvals, payroll, and performance from one structured workflow layer.',
        ctaLabel: 'Start free trial',
        ctaUrl: 'https://auth.seemplifyai.com/signup',
        secondaryLabel: 'Book a demo',
        secondaryUrl: 'https://auth.seemplifyai.com/book-demo'
      },
      {
        id: uid('text'),
        type: 'text',
        title: 'Why teams switch',
        body: '{{ contact.CUSTOM_OPENING }}'
      },
      {
        id: uid('features'),
        type: 'features',
        title: 'What Seemplify improves',
        body: '{{ contact.CUSTOM_BENEFITS }}',
        items: [
          'Structured recruiting to onboarding handoff',
          'Cleaner approvals and employee administration',
          'Real-time visibility across people operations'
        ]
      },
      {
        id: uid('cta'),
        type: 'cta',
        title: 'Ready to test it with your own workflow?',
        body: 'Start a free trial and see how Seemplify consolidates the operating layer of HR.',
        ctaLabel: 'Start free trial',
        ctaUrl: 'https://auth.seemplifyai.com/signup'
      },
      {
        id: uid('footer'),
        type: 'footer',
        body: 'You are receiving this email because your details were shared for Seemplify product updates. {{ unsubscribe }}'
      }
    ]
  }

  function createBlock(type) {
    if (type === 'hero') {
      return {
        id: uid('hero'),
        type,
        eyebrow: 'Seemplify',
        title: 'Add your headline',
        body: 'Write the opening pitch here.',
        ctaLabel: 'Start free trial',
        ctaUrl: 'https://auth.seemplifyai.com/signup',
        secondaryLabel: 'Book a demo',
        secondaryUrl: 'https://auth.seemplifyai.com/book-demo'
      }
    }

    if (type === 'features') {
      return {
        id: uid('features'),
        type,
        title: 'Benefits',
        body: 'Introduce the benefits block.',
        items: ['First benefit', 'Second benefit', 'Third benefit']
      }
    }

    if (type === 'cta') {
      return {
        id: uid('cta'),
        type,
        title: 'Ready to move?',
        body: 'Tell the reader what to do next.',
        ctaLabel: 'Start free trial',
        ctaUrl: 'https://auth.seemplifyai.com/signup'
      }
    }

    if (type === 'footer') {
      return {
        id: uid('footer'),
        type,
        body: 'You are receiving this email because your details were shared for Seemplify product updates. {{ unsubscribe }}'
      }
    }

    if (type === 'divider') {
      return {
        id: uid('divider'),
        type
      }
    }

    return {
      id: uid('text'),
      type: 'text',
      title: 'Section title',
      body: 'Write your section copy here.'
    }
  }

  function createDraftFromTemplate(template) {
    const design = clone(template && template.design ? template.design : { version: 1, blocks: defaultBlocks() })
    if (!Array.isArray(design.blocks) || design.blocks.length === 0) {
      design.blocks = defaultBlocks()
    }

    return {
      _id: '',
      name: '',
      audience: '',
      sender: {
        name: 'Seemplify',
        email: '',
        readinessBand: 'amber',
        readinessReasons: []
      },
      content: {
        subject: '{{ contact.FIRSTNAME }}, simplify HR operations with Seemplify',
        previewText: template && template.previewText ? template.previewText : 'One operating system for recruiting, onboarding, approvals, payroll, and performance.',
        replyTo: '',
        designMode: 'visual',
        design,
        htmlContent: '',
        textContent: '',
        template: template
          ? {
            templateId: template._id,
            name: template.name,
            slug: template.slug,
            category: template.category
          }
          : {}
      },
      pacing: {
        batchSize: 200,
        intervalMinutes: 30
      },
      tracking: {
        utmSource: 'seemplify',
        utmMedium: 'email',
        utmCampaign: '',
        allowExternalLinkDecoration: false
      },
      testSendEmails: [],
      status: 'draft'
    }
  }

  function getSelectedTemplate() {
    const value = String(els.campaignTemplate.value || '')
    return state.templates.find((template) => String(template._id) === value) || state.templates[0] || null
  }

  function setDraft(nextDraft) {
    state.draft = nextDraft
    renderForm()
    renderVisualPreview()
    renderHtmlEditor()
    updateActionState()
    renderSelectedCampaignSummary()
  }

  function renderStats() {
    els.campaignStatTotal.textContent = state.campaigns.length
    els.campaignStatAudiences.textContent = state.audiences.length
    els.campaignStatTemplates.textContent = state.templates.length
    els.campaignStatHealthySenders.textContent = state.senderHealth.filter((item) => item.readinessBand === 'green').length
  }

  function formatDateTime(value) {
    if (!value) return 'N/A'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'N/A'
    return date.toLocaleString()
  }

  function getStatusTone(status) {
    const normalized = String(status || '').trim().toLowerCase()
    if (normalized === 'running' || normalized === 'completed') return 'green'
    if (normalized === 'scheduled' || normalized === 'paused') return 'blue'
    if (normalized === 'failed' || normalized === 'cancelled') return 'red'
    return 'amber'
  }

  function getFilteredCampaigns() {
    const needle = String(state.campaignSearch || '').trim().toLowerCase()
    const statusFilter = String(state.campaignStatusFilter || 'all').trim().toLowerCase()

    return state.campaigns.filter((campaign) => {
      const matchesStatus = statusFilter === 'all' || String(campaign.status || '').trim().toLowerCase() === statusFilter
      if (!matchesStatus) return false
      if (!needle) return true

      const haystack = [
        campaign.name,
        campaign.status,
        campaign?.sender?.email,
        campaign?.sender?.name,
        campaign?.audience?.name
      ].join(' ').toLowerCase()

      return haystack.includes(needle)
    })
  }

  function updateCampaignListSummary(filteredCampaigns) {
    if (!els.campaignListSummary) return

    const total = state.campaigns.length
    const visible = filteredCampaigns.length
    const parts = []

    if (state.campaignSearch) {
      parts.push(`search "${state.campaignSearch}"`)
    }

    if (state.campaignStatusFilter && state.campaignStatusFilter !== 'all') {
      parts.push(`status ${state.campaignStatusFilter}`)
    }

    if (parts.length === 0) {
      els.campaignListSummary.textContent = `Showing ${visible} of ${total} campaigns. Click any campaign card to reopen it in the editor.`
      return
    }

    els.campaignListSummary.textContent = `Showing ${visible} of ${total} campaigns filtered by ${parts.join(' and ')}.`
  }

  function renderSelectedCampaignSummary() {
    if (!els.selectedCampaignSummary || !state.draft) return

    const audience = state.audiences.find((entry) => String(entry._id) === String(state.draft.audience || ''))
    const status = state.draft.status || (state.selectedCampaignId ? 'draft' : 'unsaved')
    const readiness = state.draft?.sender?.readinessBand || 'amber'
    const metrics = state.draft.metrics || {}

    els.selectedCampaignSummary.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
        <div>
          <div style="font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:700;">Current Campaign</div>
          <div style="margin-top:6px; font-size:22px; font-weight:800; color:var(--text); line-height:1.1;">${escapeHtml(state.draft.name || 'Unsaved campaign')}</div>
          <div class="admin-card-subtitle" style="margin-top:6px;">${escapeHtml(audience?.name || 'No audience selected')}</div>
        </div>
        <span class="campaign-pill ${escapeHtml(getStatusTone(status))}">${escapeHtml(status)}</span>
      </div>
      <div class="campaign-selected-grid">
        <div class="campaign-selected-item">
          <strong>Sender</strong>
          <span>${escapeHtml(state.draft?.sender?.email || 'Not set')}</span>
        </div>
        <div class="campaign-selected-item">
          <strong>Sender Readiness</strong>
          <span>${escapeHtml(readiness)}</span>
        </div>
        <div class="campaign-selected-item">
          <strong>Test Recipients</strong>
          <span>${Array.isArray(state.draft.testSendEmails) && state.draft.testSendEmails.length > 0 ? escapeHtml(state.draft.testSendEmails.join(', ')) : 'Not set'}</span>
        </div>
        <div class="campaign-selected-item">
          <strong>Last Updated</strong>
          <span>${escapeHtml(formatDateTime(state.draft.updatedAt))}</span>
        </div>
      </div>
      <div class="campaign-list-metrics">
        <div class="campaign-mini-stat">
          <span class="campaign-mini-stat-label">Queued</span>
          <span class="campaign-mini-stat-value">${Number(metrics.queued || 0)}</span>
        </div>
        <div class="campaign-mini-stat">
          <span class="campaign-mini-stat-label">Sent</span>
          <span class="campaign-mini-stat-value">${Number(metrics.sent || 0)}</span>
        </div>
        <div class="campaign-mini-stat">
          <span class="campaign-mini-stat-label">Opened</span>
          <span class="campaign-mini-stat-value">${Number(metrics.opened || 0)}</span>
        </div>
        <div class="campaign-mini-stat">
          <span class="campaign-mini-stat-label">Clicked</span>
          <span class="campaign-mini-stat-value">${Number(metrics.clicked || 0)}</span>
        </div>
      </div>
    `
  }

  function renderAudienceOptions() {
    els.campaignAudience.innerHTML = state.audiences.length === 0
      ? '<option value="">No audiences uploaded yet</option>'
      : state.audiences.map((audience) => `<option value="${escapeHtml(audience._id)}">${escapeHtml(audience.name)} (${Number(audience.contactCount || audience.contacts?.length || 0)})</option>`).join('')
  }

  function renderTemplateOptions() {
    els.campaignTemplate.innerHTML = state.templates.map((template) => `<option value="${escapeHtml(template._id)}">${escapeHtml(template.name)}</option>`).join('')
  }

  function renderForm() {
    const draft = state.draft
    els.campaignId.value = draft._id || ''
    els.campaignName.value = draft.name || ''
    renderAudienceOptions()
    renderTemplateOptions()
    if (draft.audience) {
      els.campaignAudience.value = String(draft.audience)
    }
    els.senderName.value = draft.sender?.name || ''
    els.senderEmail.value = draft.sender?.email || ''
    els.campaignSubject.value = draft.content?.subject || ''
    els.campaignPreviewText.value = draft.content?.previewText || ''
    els.campaignReplyTo.value = draft.content?.replyTo || ''
    els.campaignBatchSize.value = Number(draft.pacing?.batchSize || 200)
    els.campaignIntervalMinutes.value = Number(draft.pacing?.intervalMinutes || 30)
    els.campaignUtmSource.value = draft.tracking?.utmSource || 'seemplify'
    els.campaignUtmMedium.value = draft.tracking?.utmMedium || 'email'
    els.campaignUtmCampaign.value = draft.tracking?.utmCampaign || ''
    els.allowExternalDecoration.checked = Boolean(draft.tracking?.allowExternalLinkDecoration)
    els.campaignTestEmails.value = Array.isArray(draft.testSendEmails) ? draft.testSendEmails.join(', ') : ''
    const templateId = draft.content?.template?.templateId || draft.content?.template?._id || ''
    if (templateId) {
      els.campaignTemplate.value = String(templateId)
    } else if (state.templates[0]) {
      els.campaignTemplate.value = String(state.templates[0]._id)
    }
  }

  function renderCampaignList() {
    const campaigns = getFilteredCampaigns()
    updateCampaignListSummary(campaigns)

    if (campaigns.length === 0) {
      els.campaignList.innerHTML = state.campaigns.length === 0
        ? '<div class="campaign-empty-state">No campaigns yet.</div>'
        : '<div class="campaign-empty-state">No campaigns match the current search or status filter.</div>'
      return
    }

    els.campaignList.innerHTML = campaigns.map((campaign) => {
      const isActive = String(campaign._id) === String(state.selectedCampaignId)
      const readiness = campaign?.sender?.readinessBand || 'amber'
      const audienceName = campaign?.audience?.name || 'No audience selected'
      const metrics = campaign?.metrics || {}
      const status = campaign?.status || 'draft'
      return `
        <article class="campaign-list-card ${isActive ? 'active' : ''}" data-campaign-id="${escapeHtml(campaign._id)}">
          <div class="campaign-list-head">
            <div>
              <div style="font-weight:700; color:var(--text);">${escapeHtml(campaign.name || 'Untitled Campaign')}</div>
              <div class="admin-card-subtitle">${escapeHtml(audienceName)}</div>
            </div>
            <span class="campaign-pill ${escapeHtml(getStatusTone(status))}">${escapeHtml(status)}</span>
          </div>
          <div class="campaign-list-meta">
            <span class="admin-card-subtitle">Sender: ${escapeHtml(campaign?.sender?.email || 'Not set')} <span class="campaign-pill ${escapeHtml(readiness)}" style="margin-left:8px;">${escapeHtml(readiness)}</span></span>
            <span class="admin-card-subtitle">Pacing: ${Number(campaign?.pacing?.batchSize || 0)} every ${Number(campaign?.pacing?.intervalMinutes || 0)} min</span>
            <span class="admin-card-subtitle">Updated: ${escapeHtml(formatDateTime(campaign.updatedAt))}</span>
          </div>
          <div class="campaign-list-metrics">
            <div class="campaign-mini-stat">
              <span class="campaign-mini-stat-label">Queued</span>
              <span class="campaign-mini-stat-value">${Number(metrics.queued || 0)}</span>
            </div>
            <div class="campaign-mini-stat">
              <span class="campaign-mini-stat-label">Sent</span>
              <span class="campaign-mini-stat-value">${Number(metrics.sent || 0)}</span>
            </div>
            <div class="campaign-mini-stat">
              <span class="campaign-mini-stat-label">Opened</span>
              <span class="campaign-mini-stat-value">${Number(metrics.opened || 0)}</span>
            </div>
            <div class="campaign-mini-stat">
              <span class="campaign-mini-stat-label">Clicked</span>
              <span class="campaign-mini-stat-value">${Number(metrics.clicked || 0)}</span>
            </div>
          </div>
        </article>
      `
    }).join('')
  }

  function renderAudienceList() {
    if (state.audiences.length === 0) {
      els.audienceList.innerHTML = '<div class="campaign-empty-state">Import a CSV or Excel file in the audience studio to create your first reusable audience.</div>'
      return
    }

    els.audienceList.innerHTML = state.audiences.map((audience) => `
      <article class="campaign-audience-card">
        <div style="font-weight:700; color:var(--text);">${escapeHtml(audience.name)}</div>
        <div class="admin-card-subtitle">${escapeHtml(audience.description || audience.sourceFileName || 'Imported audience')}</div>
        <div class="admin-card-subtitle">${Number(audience.contactCount || audience.contacts?.length || 0)} contacts | ${Number(audience.importSummary?.invalidRecipients || 0)} invalid | ${Number(audience.importSummary?.duplicateRecipients || 0)} duplicates</div>
      </article>
    `).join('')
  }

  function renderTemplateList() {
    if (state.templates.length === 0) {
      els.templateList.innerHTML = '<div class="campaign-empty-state">No templates available.</div>'
      return
    }

    els.templateList.innerHTML = state.templates.map((template) => `
      <article class="campaign-template-card">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
          <div>
            <div style="font-weight:700; color:var(--text);">${escapeHtml(template.name)}</div>
            <div class="admin-card-subtitle">${escapeHtml(template.description || '')}</div>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" data-apply-template="${escapeHtml(template._id)}">Use</button>
        </div>
        <div class="admin-card-subtitle">${escapeHtml(template.category || 'custom')}</div>
      </article>
    `).join('')
  }

  function renderSenderHealth() {
    if (state.senderHealth.length === 0) {
      els.senderHealthList.innerHTML = '<div class="campaign-empty-state">No sender history yet. Enter a configured Brevo sender email in the form to validate it on save.</div>'
      return
    }

    els.senderHealthList.innerHTML = state.senderHealth.map((item) => `
      <article class="campaign-health-card">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:center;">
          <div style="font-weight:700; color:var(--text);">${escapeHtml(item.email)}</div>
          <span class="campaign-pill ${escapeHtml(item.readinessBand)}">${escapeHtml(item.readinessBand)}</span>
        </div>
        <div class="admin-card-subtitle">${escapeHtml((item.readinessReasons || []).join(' '))}</div>
      </article>
    `).join('')
  }

  function getAudienceFileBaseName(fileName) {
    return String(fileName || '')
      .replace(/\.(csv|xlsx?|xls)$/i, '')
      .trim()
  }

  function setAudienceStatus(message, tone) {
    if (!els.audienceImportStatus) return
    els.audienceImportStatus.textContent = message || ''
    els.audienceImportStatus.classList.remove('success', 'error')
    if (tone === 'success' || tone === 'error') {
      els.audienceImportStatus.classList.add(tone)
    }
  }

  function getAudienceColumnMapFromForm() {
    if (!els.audienceColumnMapping) return {}
    const next = {}
    Array.from(els.audienceColumnMapping.querySelectorAll('[data-audience-map]')).forEach((select) => {
      const field = select.getAttribute('data-audience-map')
      const value = String(select.value || '').trim()
      if (field && value) {
        next[field] = value
      }
    })
    return next
  }

  function updateAudienceImportAvailability() {
    if (!els.audienceImportBtn) return
    const columnMap = state.audiencePreview ? getAudienceColumnMapFromForm() : {}
    els.audienceImportBtn.disabled = !state.audiencePreview || !columnMap.email
  }

  function renderAudiencePreview() {
    const preview = state.audiencePreview

    if (!preview) {
      if (els.audienceSheetGroup) els.audienceSheetGroup.style.display = 'none'
      if (els.audienceMappingPanel) els.audienceMappingPanel.style.display = 'none'
      if (els.audiencePreviewMeta) els.audiencePreviewMeta.innerHTML = ''
      if (els.audienceColumnMapping) els.audienceColumnMapping.innerHTML = ''
      if (els.audiencePreviewTable) els.audiencePreviewTable.innerHTML = ''
      updateAudienceImportAvailability()
      return
    }

    if (els.audienceSheetGroup) {
      const showSheetPicker = Array.isArray(preview.sheetNames) && preview.sheetNames.length > 1
      els.audienceSheetGroup.style.display = showSheetPicker ? '' : 'none'
      if (showSheetPicker && els.audienceSheetSelect) {
        els.audienceSheetSelect.innerHTML = preview.sheetNames.map((sheetName) => `
          <option value="${escapeHtml(sheetName)}">${escapeHtml(sheetName)}</option>
        `).join('')
        els.audienceSheetSelect.value = preview.selectedSheetName || preview.sheetNames[0] || ''
      }
    }

    if (els.audiencePreviewMeta) {
      const mappedCount = Object.keys(preview.columnMap || {}).length
      els.audiencePreviewMeta.innerHTML = `
        <div class="campaign-mini-stat">
          <span class="campaign-mini-stat-label">Source</span>
          <span class="campaign-mini-stat-value">${escapeHtml(preview.sourceType || 'csv')}</span>
        </div>
        <div class="campaign-mini-stat">
          <span class="campaign-mini-stat-label">Rows Detected</span>
          <span class="campaign-mini-stat-value">${Number(preview.totalRows || 0)}</span>
        </div>
        <div class="campaign-mini-stat">
          <span class="campaign-mini-stat-label">Mapped Fields</span>
          <span class="campaign-mini-stat-value">${mappedCount}</span>
        </div>
      `
    }

    if (els.audienceColumnMapping) {
      const options = ['<option value="">Ignore this field</option>']
        .concat((preview.headers || []).map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`))
        .join('')

      els.audienceColumnMapping.innerHTML = state.audienceFields.map((field) => `
        <div class="campaign-mapping-card ${field.required ? 'required' : ''}">
          <label class="campaign-mapping-label" for="audienceMap-${escapeHtml(field.key)}">
            <span>${escapeHtml(field.label)}</span>
            ${field.required ? '<span class="campaign-pill amber">Required</span>' : ''}
          </label>
          <select id="audienceMap-${escapeHtml(field.key)}" class="admin-form-select" data-audience-map="${escapeHtml(field.key)}">
            ${options}
          </select>
          <div class="campaign-mapping-description">${escapeHtml(field.description || '')}</div>
        </div>
      `).join('')

      Array.from(els.audienceColumnMapping.querySelectorAll('[data-audience-map]')).forEach((select) => {
        const key = select.getAttribute('data-audience-map')
        select.value = preview.columnMap?.[key] || ''
      })
    }

    if (els.audiencePreviewTable) {
      if (!Array.isArray(preview.sampleRows) || preview.sampleRows.length === 0) {
        els.audiencePreviewTable.innerHTML = '<div class="campaign-empty-state">No sample rows were found after the header row.</div>'
      } else {
        els.audiencePreviewTable.innerHTML = `
          <table class="campaign-preview-table">
            <thead>
              <tr>${(preview.headers || []).map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${preview.sampleRows.map((row) => `
                <tr>${(preview.headers || []).map((_, index) => `<td>${escapeHtml((row && row[index]) || '-')}</td>`).join('')}</tr>
              `).join('')}
            </tbody>
          </table>
        `
      }
    }

    if (els.audienceMappingPanel) {
      els.audienceMappingPanel.style.display = ''
    }

    updateAudienceImportAvailability()
  }

  function resetAudiencePreviewState(clearForm) {
    state.audiencePreview = null
    if (clearForm && els.audienceUploadForm) {
      els.audienceUploadForm.reset()
    }
    renderAudiencePreview()
    setAudienceStatus('No file extracted yet.')
  }

  async function previewAudienceImport(event, requestedSheetName) {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault()
    }

    const file = els.audienceFile.files && els.audienceFile.files[0]
    if (!file) {
      throw new Error('Choose a CSV or Excel file first.')
    }

    const data = new FormData()
    data.append('file', file)
    if (requestedSheetName || els.audienceSheetSelect.value) {
      data.append('sheetName', requestedSheetName || els.audienceSheetSelect.value)
    }

    const response = await fetch('/api/admin/campaign-audiences/preview', {
      method: 'POST',
      body: data
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to extract audience fields.')
    }

    if (Array.isArray(payload.fields) && payload.fields.length > 0) {
      state.audienceFields = payload.fields
    }

    state.audiencePreview = payload.preview || null
    if (!els.audienceName.value.trim()) {
      els.audienceName.value = getAudienceFileBaseName(file.name)
    }
    renderAudiencePreview()
    setAudienceStatus(`Extracted ${Number(state.audiencePreview?.totalRows || 0)} rows from ${file.name}.`, 'success')
  }

  async function importAudienceFromPreview() {
    const file = els.audienceFile.files && els.audienceFile.files[0]
    if (!file) {
      throw new Error('Choose a CSV or Excel file first.')
    }

    if (!state.audiencePreview) {
      throw new Error('Extract the file fields before importing the audience.')
    }

    const columnMap = getAudienceColumnMapFromForm()
    if (!columnMap.email) {
      throw new Error('Map the Email field before importing the audience.')
    }

    const data = new FormData()
    data.append('file', file)
    data.append('name', els.audienceName.value.trim() || getAudienceFileBaseName(file.name))
    data.append('description', els.audienceDescription.value.trim())
    data.append('columnMap', JSON.stringify(columnMap))
    if (state.audiencePreview.selectedSheetName) {
      data.append('sheetName', state.audiencePreview.selectedSheetName)
    }

    const response = await fetch('/api/admin/campaign-audiences/import', {
      method: 'POST',
      body: data
    })
    const result = await response.json()
    if (!response.ok) {
      throw new Error(Array.isArray(result.details) && result.details.length > 0
        ? result.details.join('\n')
        : (result.error || 'Failed to upload audience.'))
    }

    await refreshAudiences()
    if (result.audience && state.draft) {
      state.draft.audience = result.audience._id
      renderForm()
      renderSelectedCampaignSummary()
    }
    resetAudiencePreviewState(true)
    setAudienceStatus(result.message || 'Audience imported.', 'success')
  }

  function buildPreviewBlock(block) {
    const commonToolbar = `
      <div class="campaign-block-toolbar">
        <strong draggable="false">${escapeHtml(block.type)}</strong>
        <div class="campaign-block-actions">
          <button type="button" data-duplicate-block="${escapeHtml(block.id)}">+</button>
          <button type="button" data-remove-block="${escapeHtml(block.id)}">x</button>
        </div>
      </div>
    `

    if (block.type === 'divider') {
      return `
        <div class="campaign-block" draggable="true" data-block-id="${escapeHtml(block.id)}">
          ${commonToolbar}
          <div class="campaign-block-body" data-type="divider">
            <div style="height:1px; background:rgba(31,22,55,.12);"></div>
          </div>
        </div>
      `
    }

    if (block.type === 'hero') {
      return `
        <div class="campaign-block" draggable="true" data-block-id="${escapeHtml(block.id)}">
          ${commonToolbar}
          <div class="campaign-block-body" data-type="hero">
            <div class="campaign-preview-eyebrow campaign-preview-editable" contenteditable="true" data-field="eyebrow">${block.eyebrow || ''}</div>
            <div class="campaign-preview-title campaign-preview-editable" contenteditable="true" data-field="title">${escapeHtml(block.title || '')}</div>
            <div class="campaign-preview-subtitle campaign-preview-editable" contenteditable="true" data-field="body">${block.body || ''}</div>
            <div class="campaign-preview-buttons">
              <a class="campaign-preview-button primary" href="#">
                <input class="campaign-mini-input" data-input-field="ctaLabel" value="${escapeHtml(block.ctaLabel || '')}">
              </a>
              <input class="campaign-mini-input" data-input-field="ctaUrl" value="${escapeHtml(block.ctaUrl || '')}">
            </div>
            <div class="campaign-preview-buttons">
              <a class="campaign-preview-button secondary" href="#">
                <input class="campaign-mini-input" data-input-field="secondaryLabel" value="${escapeHtml(block.secondaryLabel || '')}">
              </a>
              <input class="campaign-mini-input" data-input-field="secondaryUrl" value="${escapeHtml(block.secondaryUrl || '')}">
            </div>
          </div>
        </div>
      `
    }

    if (block.type === 'features') {
      const items = Array.isArray(block.items) ? block.items : []
      return `
        <div class="campaign-block" draggable="true" data-block-id="${escapeHtml(block.id)}">
          ${commonToolbar}
          <div class="campaign-block-body" data-type="features">
            <div class="campaign-preview-title campaign-preview-editable" contenteditable="true" data-field="title">${escapeHtml(block.title || '')}</div>
            <div class="campaign-preview-subtitle campaign-preview-editable" contenteditable="true" data-field="body">${block.body || ''}</div>
            <div class="campaign-preview-items">
              ${items.map((item, index) => `
                <div class="campaign-preview-item" data-item-index="${index}">
                  <span class="campaign-preview-item-badge">+</span>
                  <div class="campaign-preview-editable" contenteditable="true" data-item-field="items">${item || ''}</div>
                  <button type="button" data-remove-item="${escapeHtml(block.id)}" data-item-index="${index}">x</button>
                </div>
              `).join('')}
            </div>
            <button class="btn btn-secondary btn-sm" type="button" data-add-item="${escapeHtml(block.id)}">Add item</button>
          </div>
        </div>
      `
    }

    if (block.type === 'cta') {
      return `
        <div class="campaign-block" draggable="true" data-block-id="${escapeHtml(block.id)}">
          ${commonToolbar}
          <div class="campaign-block-body" data-type="cta">
            <div class="campaign-preview-title campaign-preview-editable" contenteditable="true" data-field="title">${escapeHtml(block.title || '')}</div>
            <div class="campaign-preview-subtitle campaign-preview-editable" contenteditable="true" data-field="body">${block.body || ''}</div>
            <div class="campaign-mini-grid">
              <input class="campaign-mini-input" data-input-field="ctaLabel" value="${escapeHtml(block.ctaLabel || '')}">
              <input class="campaign-mini-input" data-input-field="ctaUrl" value="${escapeHtml(block.ctaUrl || '')}">
            </div>
          </div>
        </div>
      `
    }

    if (block.type === 'footer') {
      return `
        <div class="campaign-block" draggable="true" data-block-id="${escapeHtml(block.id)}">
          ${commonToolbar}
          <div class="campaign-block-body" data-type="footer">
            <div class="campaign-preview-subtitle campaign-preview-editable" contenteditable="true" data-field="body">${block.body || ''}</div>
          </div>
        </div>
      `
    }

    return `
      <div class="campaign-block" draggable="true" data-block-id="${escapeHtml(block.id)}">
        ${commonToolbar}
        <div class="campaign-block-body" data-type="text">
          <div class="campaign-preview-title campaign-preview-editable" contenteditable="true" data-field="title">${escapeHtml(block.title || '')}</div>
          <div class="campaign-preview-subtitle campaign-preview-editable" contenteditable="true" data-field="body">${block.body || ''}</div>
        </div>
      </div>
    `
  }

  function renderVisualPreview() {
    const blocks = Array.isArray(state.draft.content?.design?.blocks) ? state.draft.content.design.blocks : []
    els.visualPreview.innerHTML = blocks.length === 0
      ? '<div class="campaign-empty-state">Add blocks from the palette to build the email.</div>'
      : blocks.map(buildPreviewBlock).join('')
  }

  function renderEmailHtmlFromBlocks() {
    const blocks = Array.isArray(state.draft.content?.design?.blocks) ? state.draft.content.design.blocks : []
    const sections = blocks.map((block) => {
      if (block.type === 'divider') {
        return '<div style="height:1px;background:rgba(31,22,55,.12);"></div>'
      }
      if (block.type === 'hero') {
        return `
          <section style="padding:32px;border-radius:28px;background:linear-gradient(160deg,#6d28d9 0%, #221934 100%);color:#ffffff;">
            <div style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;opacity:.72;">${block.eyebrow || ''}</div>
            <h1 style="margin:14px 0;font-size:34px;line-height:1.08;">${block.title || ''}</h1>
            <div style="font-size:15px;line-height:1.7;">${block.body || ''}</div>
          </section>
        `
      }
      if (block.type === 'features') {
        return `
          <section style="padding:24px;border-radius:24px;background:#ffffff;border:1px solid rgba(31,22,55,.08);">
            <h2 style="margin:0 0 10px;font-size:24px;color:#221934;">${block.title || ''}</h2>
            <div style="font-size:15px;line-height:1.7;color:#3f3656;margin-bottom:12px;">${block.body || ''}</div>
            <ul style="padding-left:18px;margin:0;color:#3f3656;line-height:1.7;">${(block.items || []).map((item) => `<li>${item}</li>`).join('')}</ul>
          </section>
        `
      }
      if (block.type === 'cta') {
        return `
          <section style="padding:24px;border-radius:24px;background:rgba(109,40,217,.06);border:1px solid rgba(109,40,217,.14);">
            <h2 style="margin:0 0 10px;font-size:24px;color:#221934;">${block.title || ''}</h2>
            <div style="font-size:15px;line-height:1.7;color:#3f3656;margin-bottom:14px;">${block.body || ''}</div>
            <a href="${block.ctaUrl || '#'}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:linear-gradient(135deg,#14b8a6,#6d28d9);color:#fff;text-decoration:none;font-weight:700;">${block.ctaLabel || ''}</a>
          </section>
        `
      }
      if (block.type === 'footer') {
        return `<footer style="font-size:12px;line-height:1.8;color:#6d6485;">${block.body || ''}</footer>`
      }
      return `
        <section style="padding:24px;border-radius:24px;background:#ffffff;border:1px solid rgba(31,22,55,.08);">
          <h2 style="margin:0 0 10px;font-size:24px;color:#221934;">${block.title || ''}</h2>
          <div style="font-size:15px;line-height:1.7;color:#3f3656;">${block.body || ''}</div>
        </section>
      `
    }).join('<div style="height:16px;"></div>')

    return `<!DOCTYPE html><html><body style="margin:0;padding:28px;background:#f6f0ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:680px;margin:0 auto;display:grid;gap:16px;">${sections}</div></body></html>`
  }

  function renderHtmlEditor() {
    if (!state.draft.content.htmlContent) {
      state.draft.content.htmlContent = renderEmailHtmlFromBlocks()
    }
    els.htmlEditor.value = state.draft.content.htmlContent || ''
    els.htmlPreview.innerHTML = state.draft.content.htmlContent || ''
  }

  function updateActionState() {
    const hasCampaign = Boolean(state.selectedCampaignId)
    els.campaignDetailLink.href = hasCampaign ? `/admin/campaigns/${encodeURIComponent(state.selectedCampaignId)}` : '#'
    els.pauseCampaignBtn.disabled = !hasCampaign
    els.resumeCampaignBtn.disabled = !hasCampaign
    els.cancelCampaignBtn.disabled = !hasCampaign
    els.launchCampaignBtn.disabled = false
  }

  function syncDraftFromForm() {
    state.draft.name = els.campaignName.value.trim()
    state.draft.audience = els.campaignAudience.value || ''
    state.draft.sender.name = els.senderName.value.trim()
    state.draft.sender.email = els.senderEmail.value.trim().toLowerCase()
    state.draft.content.subject = els.campaignSubject.value.trim()
    state.draft.content.previewText = els.campaignPreviewText.value.trim()
    state.draft.content.replyTo = els.campaignReplyTo.value.trim().toLowerCase()
    state.draft.pacing.batchSize = Number(els.campaignBatchSize.value || 200)
    state.draft.pacing.intervalMinutes = Number(els.campaignIntervalMinutes.value || 30)
    state.draft.tracking.utmSource = els.campaignUtmSource.value.trim() || 'seemplify'
    state.draft.tracking.utmMedium = els.campaignUtmMedium.value.trim() || 'email'
    state.draft.tracking.utmCampaign = els.campaignUtmCampaign.value.trim()
    state.draft.tracking.allowExternalLinkDecoration = Boolean(els.allowExternalDecoration.checked)
    state.draft.testSendEmails = els.campaignTestEmails.value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
    const template = state.templates.find((item) => String(item._id) === String(els.campaignTemplate.value))
    state.draft.content.template = template
      ? {
        templateId: template._id,
        name: template.name,
        slug: template.slug,
        category: template.category
      }
      : {}
  }

  function getBlockById(blockId) {
    return (state.draft.content.design.blocks || []).find((block) => String(block.id) === String(blockId)) || null
  }

  function syncVisualStateFromDom() {
    const blocks = []
    Array.from(els.visualPreview.querySelectorAll('[data-block-id]')).forEach((blockEl) => {
      const blockId = blockEl.getAttribute('data-block-id')
      const source = getBlockById(blockId) || {}
      const next = clone(source)
      next.id = blockId
      next.type = source.type || 'text'
      blockEl.querySelectorAll('[data-field]').forEach((fieldEl) => {
        const key = fieldEl.getAttribute('data-field')
        next[key] = key === 'title' || key === 'eyebrow'
          ? fieldEl.innerText.trim()
          : fieldEl.innerHTML
      })
      blockEl.querySelectorAll('[data-input-field]').forEach((input) => {
        next[input.getAttribute('data-input-field')] = input.value
      })
      if (next.type === 'features') {
        next.items = Array.from(blockEl.querySelectorAll('[data-item-field="items"]')).map((item) => item.innerHTML)
      }
      blocks.push(next)
    })
    state.draft.content.design.blocks = blocks
  }

  async function refreshCampaigns() {
    const response = await fetch('/api/admin/campaigns')
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Failed to load campaigns.')
    state.campaigns = Array.isArray(payload.campaigns) ? payload.campaigns : []
    renderCampaignList()
    renderStats()
  }

  async function refreshAudiences() {
    const response = await fetch('/api/admin/campaign-audiences')
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Failed to load audiences.')
    state.audiences = Array.isArray(payload.audiences) ? payload.audiences : []
    renderAudienceOptions()
    renderAudienceList()
    renderSelectedCampaignSummary()
    renderStats()
  }

  async function refreshSenderHealth() {
    const response = await fetch('/api/admin/campaign-senders/health')
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Failed to load sender health.')
    state.senderHealth = Array.isArray(payload.senders) ? payload.senders : []
    renderSenderHealth()
    renderStats()
  }

  async function loadCampaign(campaignId) {
    const response = await fetch(`/api/admin/campaigns/${encodeURIComponent(campaignId)}`)
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Failed to load campaign.')
    state.selectedCampaignId = payload.campaign._id
    setDraft(payload.campaign)
    renderCampaignList()
  }

  function switchMode(mode) {
    state.mode = mode
    state.draft.content.designMode = mode
    const isVisual = mode === 'visual'
    els.visualBuilder.style.display = isVisual ? '' : 'none'
    els.htmlBuilder.style.display = isVisual ? 'none' : ''
    els.visualModeBtn.classList.toggle('active', isVisual)
    els.htmlModeBtn.classList.toggle('active', !isVisual)
    if (!isVisual) {
      syncVisualStateFromDom()
      state.draft.content.htmlContent = renderEmailHtmlFromBlocks()
      renderHtmlEditor()
    }
  }

  function hideLinkPopover() {
    state.linkRange = null
    state.linkHost = null
    els.linkPopover.classList.remove('show')
  }

  function saveSelection(host) {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideLinkPopover()
      return
    }
    const range = selection.getRangeAt(0)
    if (!host.contains(range.commonAncestorContainer)) {
      hideLinkPopover()
      return
    }

    const rect = range.getBoundingClientRect()
    state.linkRange = range.cloneRange()
    state.linkHost = host
    const anchor = selection.anchorNode && selection.anchorNode.parentElement ? selection.anchorNode.parentElement.closest('a') : null
    els.linkPopoverInput.value = anchor ? anchor.getAttribute('href') || '' : ''
    els.linkPopover.style.left = `${Math.max(12, rect.left + (rect.width / 2) - 140)}px`
    els.linkPopover.style.top = `${Math.max(12, rect.top - 72)}px`
    els.linkPopover.classList.add('show')
  }

  function restoreSelection() {
    if (!state.linkRange) return false
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(state.linkRange)
    return true
  }

  function applyLink(url) {
    if (!restoreSelection()) return
    document.execCommand('createLink', false, url)
    if (state.linkHost === els.visualPreview) {
      syncVisualStateFromDom()
    } else if (state.linkHost === els.htmlPreview) {
      state.draft.content.htmlContent = els.htmlPreview.innerHTML
      els.htmlEditor.value = state.draft.content.htmlContent
    }
    hideLinkPopover()
  }

  async function saveDraft() {
    if (state.mode === 'visual') {
      syncVisualStateFromDom()
    } else {
      state.draft.content.htmlContent = els.htmlEditor.value
    }
    syncDraftFromForm()

    const payload = {
      name: state.draft.name,
      audienceId: state.draft.audience,
      senderName: state.draft.sender.name,
      senderEmail: state.draft.sender.email,
      subject: state.draft.content.subject,
      previewText: state.draft.content.previewText,
      replyTo: state.draft.content.replyTo,
      designMode: state.draft.content.designMode,
      design: state.draft.content.design,
      htmlContent: state.draft.content.htmlContent,
      textContent: state.draft.content.textContent || '',
      templateId: state.draft.content.template?.templateId || '',
      batchSize: state.draft.pacing.batchSize,
      intervalMinutes: state.draft.pacing.intervalMinutes,
      utmSource: state.draft.tracking.utmSource,
      utmMedium: state.draft.tracking.utmMedium,
      utmCampaign: state.draft.tracking.utmCampaign,
      allowExternalLinkDecoration: state.draft.tracking.allowExternalLinkDecoration,
      testSendEmails: state.draft.testSendEmails
    }

    const isUpdate = Boolean(state.selectedCampaignId)
    const response = await fetch(isUpdate ? `/api/admin/campaigns/${encodeURIComponent(state.selectedCampaignId)}` : '/api/admin/campaigns', {
      method: isUpdate ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to save draft.')

    state.selectedCampaignId = result.campaign._id
    state.draft = result.campaign
    await Promise.all([refreshCampaigns(), refreshSenderHealth()])
    renderForm()
    updateActionState()
    alert(result.message || 'Campaign saved.')
    return result.campaign
  }

  async function ensureSavedCampaign() {
    if (!state.selectedCampaignId) {
      return saveDraft()
    }
    return state.draft
  }

  function validateTestSendState() {
    syncDraftFromForm()

    if (!String(state.draft.name || '').trim()) {
      throw new Error('Enter a campaign name before sending a test.')
    }

    if (!String(state.draft.sender?.email || '').trim()) {
      throw new Error('Set a sender email before sending a test.')
    }

    if (!isValidEmail(state.draft.sender.email)) {
      throw new Error('The sender email is not valid.')
    }

    const emails = Array.isArray(state.draft.testSendEmails) ? state.draft.testSendEmails : []
    if (emails.length === 0) {
      throw new Error('Add at least one test email before sending a test.')
    }

    const invalidEmails = emails.filter((email) => !isValidEmail(email))
    if (invalidEmails.length > 0) {
      throw new Error(`Invalid test email${invalidEmails.length === 1 ? '' : 's'}: ${invalidEmails.join(', ')}`)
    }

    if (!String(state.draft.content?.subject || '').trim()) {
      throw new Error('Add a campaign subject before sending a test.')
    }
  }

  async function handleLifecycle(action, extraPayload) {
    await ensureSavedCampaign()
    const response = await fetch(`/api/admin/campaigns/${encodeURIComponent(state.selectedCampaignId)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(extraPayload || {})
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || `Failed to ${action} campaign.`)
    state.draft = result.campaign
    await Promise.all([refreshCampaigns(), refreshSenderHealth()])
    renderForm()
    updateActionState()
    alert(result.message || `Campaign ${action}d.`)
  }

  function resetDraft() {
    state.selectedCampaignId = ''
    setDraft(createDraftFromTemplate(getSelectedTemplate()))
    renderCampaignList()
  }

  async function uploadAudience(event) {
    await previewAudienceImport(event)
  }

  els.visualModeBtn.addEventListener('click', function () {
    switchMode('visual')
  })

  els.htmlModeBtn.addEventListener('click', function () {
    switchMode('html')
  })

  els.newCampaignBtn.addEventListener('click', function () {
    resetDraft()
  })

  els.saveCampaignBtn.addEventListener('click', function () {
    saveDraft().catch((error) => alert(error.message || 'Failed to save draft.'))
  })

  els.launchCampaignBtn.addEventListener('click', function () {
    handleLifecycle('launch', { overrideSenderQuality: true }).catch((error) => alert(error.message || 'Failed to launch campaign.'))
  })

  els.pauseCampaignBtn.addEventListener('click', function () {
    handleLifecycle('pause').catch((error) => alert(error.message || 'Failed to pause campaign.'))
  })

  els.resumeCampaignBtn.addEventListener('click', function () {
    handleLifecycle('resume').catch((error) => alert(error.message || 'Failed to resume campaign.'))
  })

  els.cancelCampaignBtn.addEventListener('click', function () {
    if (!window.confirm('Cancel this campaign and stop remaining batches?')) return
    handleLifecycle('cancel').catch((error) => alert(error.message || 'Failed to cancel campaign.'))
  })

  els.sendTestBtn.addEventListener('click', async function () {
    try {
      validateTestSendState()
      await ensureSavedCampaign()
      const emails = els.campaignTestEmails.value.trim()
      const response = await fetch(`/api/admin/campaigns/${encodeURIComponent(state.selectedCampaignId)}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails })
      })
      const result = await response.json()
      if (!response.ok) {
        const message = Array.isArray(result.details) && result.details.length > 0
          ? result.details.join('\n')
          : (result.error || 'Failed to send test campaign.')
        throw new Error(message)
      }
      alert(result.message || 'Test sent.')
    } catch (error) {
      alert(error.message || 'Failed to send test campaign.')
    }
  })

  els.audienceUploadForm.addEventListener('submit', function (event) {
    uploadAudience(event).catch((error) => {
      setAudienceStatus(error.message || 'Failed to extract audience fields.', 'error')
    })
  })

  if (els.audienceImportBtn) {
    els.audienceImportBtn.addEventListener('click', function () {
      importAudienceFromPreview().catch((error) => {
        setAudienceStatus(error.message || 'Failed to upload audience.', 'error')
      })
    })
  }

  if (els.audienceResetBtn) {
    els.audienceResetBtn.addEventListener('click', function () {
      resetAudiencePreviewState(true)
    })
  }

  if (els.audienceFile) {
    els.audienceFile.addEventListener('change', function () {
      state.audiencePreview = null
      renderAudiencePreview()
      if (els.audienceFile.files && els.audienceFile.files[0] && !els.audienceName.value.trim()) {
        els.audienceName.value = getAudienceFileBaseName(els.audienceFile.files[0].name)
      }
      setAudienceStatus('File selected. Click "Extract Fields" to inspect and map the columns.')
    })
  }

  if (els.audienceSheetSelect) {
    els.audienceSheetSelect.addEventListener('change', function () {
      previewAudienceImport(null, els.audienceSheetSelect.value).catch((error) => {
        setAudienceStatus(error.message || 'Failed to extract audience fields.', 'error')
      })
    })
  }

  if (els.audienceColumnMapping) {
    els.audienceColumnMapping.addEventListener('change', function () {
      if (!state.audiencePreview) return
      state.audiencePreview.columnMap = getAudienceColumnMapFromForm()
      renderAudiencePreview()
      setAudienceStatus('Field mapping updated. Import the audience when you are ready.')
    })
  }

  if (els.campaignSearchInput) {
    els.campaignSearchInput.addEventListener('input', function () {
      state.campaignSearch = els.campaignSearchInput.value.trim()
      renderCampaignList()
    })
  }

  if (els.campaignStatusFilter) {
    els.campaignStatusFilter.addEventListener('change', function () {
      state.campaignStatusFilter = els.campaignStatusFilter.value || 'all'
      renderCampaignList()
    })
  }

  els.campaignTemplate.addEventListener('change', function () {
    const template = getSelectedTemplate()
    if (!template) return
    const nextDraft = createDraftFromTemplate(template)
    nextDraft.name = state.draft.name || ''
    nextDraft.audience = state.draft.audience || ''
    nextDraft.sender = clone(state.draft.sender || nextDraft.sender)
    nextDraft.tracking = clone(state.draft.tracking || nextDraft.tracking)
    nextDraft.testSendEmails = clone(state.draft.testSendEmails || [])
    setDraft(nextDraft)
  })

  els.campaignList.addEventListener('click', function (event) {
    const card = event.target.closest('[data-campaign-id]')
    if (!card) return
    loadCampaign(card.getAttribute('data-campaign-id')).catch((error) => alert(error.message || 'Failed to load campaign.'))
  })

  els.templateList.addEventListener('click', function (event) {
    const button = event.target.closest('[data-apply-template]')
    if (!button) return
    const template = state.templates.find((item) => String(item._id) === String(button.getAttribute('data-apply-template')))
    if (!template) return
    const nextDraft = createDraftFromTemplate(template)
    nextDraft.name = state.draft.name || ''
    nextDraft.audience = state.draft.audience || ''
    nextDraft.sender = clone(state.draft.sender || nextDraft.sender)
    nextDraft.tracking = clone(state.draft.tracking || nextDraft.tracking)
    nextDraft.testSendEmails = clone(state.draft.testSendEmails || [])
    setDraft(nextDraft)
  })

  document.querySelectorAll('[data-add-block]').forEach((button) => {
    button.addEventListener('click', function () {
      state.draft.content.design.blocks.push(createBlock(button.getAttribute('data-add-block')))
      renderVisualPreview()
    })
  })

  els.visualPreview.addEventListener('input', function (event) {
    const blockEl = event.target.closest('[data-block-id]')
    if (!blockEl) return
    const block = getBlockById(blockEl.getAttribute('data-block-id'))
    if (!block) return

    if (event.target.hasAttribute('data-field')) {
      const key = event.target.getAttribute('data-field')
      block[key] = key === 'title' || key === 'eyebrow' ? event.target.innerText.trim() : event.target.innerHTML
    }

    if (event.target.hasAttribute('data-item-field')) {
      const items = Array.from(blockEl.querySelectorAll('[data-item-field="items"]')).map((item) => item.innerHTML)
      block.items = items
    }
  })

  els.visualPreview.addEventListener('change', function (event) {
    const blockEl = event.target.closest('[data-block-id]')
    if (!blockEl || !event.target.hasAttribute('data-input-field')) return
    const block = getBlockById(blockEl.getAttribute('data-block-id'))
    if (!block) return
    block[event.target.getAttribute('data-input-field')] = event.target.value
  })

  els.visualPreview.addEventListener('click', function (event) {
    const removeButton = event.target.closest('[data-remove-block]')
    if (removeButton) {
      state.draft.content.design.blocks = state.draft.content.design.blocks.filter((block) => String(block.id) !== String(removeButton.getAttribute('data-remove-block')))
      renderVisualPreview()
      return
    }

    const duplicateButton = event.target.closest('[data-duplicate-block]')
    if (duplicateButton) {
      const source = getBlockById(duplicateButton.getAttribute('data-duplicate-block'))
      if (!source) return
      const copy = clone(source)
      copy.id = uid(source.type || 'block')
      const blocks = state.draft.content.design.blocks
      const index = blocks.findIndex((block) => String(block.id) === String(source.id))
      blocks.splice(index + 1, 0, copy)
      renderVisualPreview()
      return
    }

    const addItemButton = event.target.closest('[data-add-item]')
    if (addItemButton) {
      const block = getBlockById(addItemButton.getAttribute('data-add-item'))
      if (!block) return
      block.items = Array.isArray(block.items) ? block.items : []
      block.items.push('New item')
      renderVisualPreview()
      return
    }

    const removeItemButton = event.target.closest('[data-remove-item]')
    if (removeItemButton) {
      const block = getBlockById(removeItemButton.getAttribute('data-remove-item'))
      if (!block) return
      const itemIndex = Number(removeItemButton.getAttribute('data-item-index') || 0)
      block.items.splice(itemIndex, 1)
      renderVisualPreview()
    }
  })

  els.visualPreview.addEventListener('dragstart', function (event) {
    const block = event.target.closest('[data-block-id]')
    if (!block) return
    state.draggingBlockId = block.getAttribute('data-block-id')
    block.classList.add('is-dragging')
  })

  els.visualPreview.addEventListener('dragend', function (event) {
    const block = event.target.closest('[data-block-id]')
    if (block) block.classList.remove('is-dragging')
  })

  els.visualPreview.addEventListener('dragover', function (event) {
    event.preventDefault()
  })

  els.visualPreview.addEventListener('drop', function (event) {
    event.preventDefault()
    const target = event.target.closest('[data-block-id]')
    if (!target || !state.draggingBlockId || target.getAttribute('data-block-id') === state.draggingBlockId) return
    const blocks = state.draft.content.design.blocks
    const sourceIndex = blocks.findIndex((block) => String(block.id) === String(state.draggingBlockId))
    const targetIndex = blocks.findIndex((block) => String(block.id) === String(target.getAttribute('data-block-id')))
    if (sourceIndex < 0 || targetIndex < 0) return
    const moved = blocks.splice(sourceIndex, 1)[0]
    blocks.splice(targetIndex, 0, moved)
    state.draggingBlockId = ''
    renderVisualPreview()
  })

  els.visualPreview.addEventListener('mouseup', function () {
    saveSelection(els.visualPreview)
  })

  els.htmlEditor.addEventListener('input', function () {
    state.draft.content.htmlContent = els.htmlEditor.value
    els.htmlPreview.innerHTML = state.draft.content.htmlContent
  })

  els.htmlPreview.addEventListener('input', function () {
    state.draft.content.htmlContent = els.htmlPreview.innerHTML
    els.htmlEditor.value = state.draft.content.htmlContent
  })

  els.htmlPreview.addEventListener('mouseup', function () {
    saveSelection(els.htmlPreview)
  })

  els.applyLinkBtn.addEventListener('click', function () {
    if (!els.linkPopoverInput.value.trim()) {
      hideLinkPopover()
      return
    }
    applyLink(els.linkPopoverInput.value.trim())
  })

  els.unlinkSelectionBtn.addEventListener('click', function () {
    if (!restoreSelection()) return
    document.execCommand('unlink', false, null)
    if (state.linkHost === els.visualPreview) {
      syncVisualStateFromDom()
    } else if (state.linkHost === els.htmlPreview) {
      state.draft.content.htmlContent = els.htmlPreview.innerHTML
      els.htmlEditor.value = state.draft.content.htmlContent
    }
    hideLinkPopover()
  })

  document.addEventListener('mousedown', function (event) {
    if (els.linkPopover.contains(event.target)) return
    if (event.target.closest('.campaign-preview-editable')) return
    hideLinkPopover()
  })

  renderStats()
  renderCampaignList()
  renderAudienceList()
  renderTemplateList()
  renderSenderHealth()
  setDraft(createDraftFromTemplate(state.templates[0] || null))
  switchMode('visual')
  renderForm()
})()

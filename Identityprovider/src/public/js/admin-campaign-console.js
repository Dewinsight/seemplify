(function () {
  const boot = window.__CAMPAIGN_CONSOLE__ || {}
  const initialSelectedCampaign = boot.selectedCampaign && typeof boot.selectedCampaign === 'object'
    ? boot.selectedCampaign
    : null
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
  const AUDIENCE_FIELD_VARIABLES = {
    email: {
      tokens: ['{{ contact.EMAIL }}']
    },
    firstName: {
      tokens: ['{{ contact.FIRSTNAME }}']
    },
    lastName: {
      tokens: ['{{ contact.LASTNAME }}']
    },
    role: {
      tokens: ['{{ contact.ROLE }}']
    },
    jobTitle: {
      tokens: ['{{ contact.JOBTITLE }}']
    },
    jobLevel: {
      tokens: ['{{ contact.JOBLEVEL }}']
    },
    department: {
      tokens: ['{{ contact.DEPARTMENT }}']
    },
    companyName: {
      tokens: ['{{ contact.COMPANYNAME }}']
    },
    industry: {
      tokens: ['{{ contact.INDUSTRY }}']
    },
    companyHeadCount: {
      tokens: ['{{ contact.HEADCOUNT }}']
    },
    location: {
      tokens: ['{{ contact.LOCATION }}']
    },
    companyDescription: {
      tokens: ['{{ contact.COMPANYDESCRIPTION }}']
    },
    tailoredMessage: {
      tokens: ['{{ contact.CUSTOM_OPENING }}'],
      note: 'Tailored Message feeds the personalized opening. There is no direct {{ contact.TAILORED_MESSAGE }} merge tag.'
    }
  }
  const DERIVED_VARIABLES = [
    {
      label: 'Personalized opening',
      tokens: ['{{ contact.CUSTOM_OPENING }}'],
      description: 'Uses Tailored Message when you map it. If that field is blank, Seemplify builds the opening from role, job title, and company name.',
      sourceFields: ['tailoredMessage', 'role', 'jobTitle', 'companyName']
    },
    {
      label: 'Benefits copy',
      tokens: ['{{ contact.CUSTOM_BENEFITS }}'],
      description: 'Generated from role, job title, job level, and department to adapt the benefits section automatically.',
      sourceFields: ['role', 'jobTitle', 'jobLevel', 'department']
    },
    {
      label: 'Free trial link',
      tokens: ['{{ contact.FREE_TRIAL_URL }}'],
      description: 'System variable provided by Seemplify for CTA buttons and links. This does not come from the uploaded file.',
      sourceFields: []
    },
    {
      label: 'Campaign variables',
      tokens: ['{{ campaign.NAME }}', '{{ campaign.UTM_CAMPAIGN }}'],
      description: 'These come from the campaign form itself, not from the imported audience file.',
      sourceFields: []
    }
  ]
  const CAMPAIGN_WORKSPACE_STEPS = [
    { key: 'setup', label: 'Setup' },
    { key: 'sequence', label: 'Sequence' },
    { key: 'content', label: 'Content' },
    { key: 'audience', label: 'Audience' },
    { key: 'review', label: 'Review & Send' }
  ]

  const state = {
    campaigns: Array.isArray(boot.campaigns) ? boot.campaigns : [],
    audiences: Array.isArray(boot.audiences) ? boot.audiences : [],
    templates: Array.isArray(boot.templates) ? boot.templates : [],
    senderHealth: Array.isArray(boot.senderHealth) ? boot.senderHealth : [],
    audienceFields: Array.isArray(boot.audienceFields) && boot.audienceFields.length > 0 ? boot.audienceFields : DEFAULT_AUDIENCE_FIELDS,
    selectedCampaignId: initialSelectedCampaign && initialSelectedCampaign._id ? String(initialSelectedCampaign._id) : '',
    mode: 'visual',
    draft: null,
    draggingBlockId: '',
    linkRange: null,
    linkHost: null,
    campaignSearch: '',
    campaignStatusFilter: 'all',
    templateSearch: '',
    templateCategoryFilter: 'all',
    audiencePreview: null,
    customerContacts: [],
    selectedCustomerIds: new Set(),
    activeSequenceStepIndex: 0,
    activeStep: 'setup'
  }
  const workspaceMode = String(boot.workspaceMode || '').trim().toLowerCase()

  const audienceWorkspaceMount = document.getElementById('audienceWorkspaceMount')
  if (audienceWorkspaceMount) {
    document.querySelectorAll('[data-audience-workspace-card]').forEach((card) => {
      audienceWorkspaceMount.appendChild(card)
    })
  }

  const els = {
    campaignId: document.getElementById('campaignId'),
    campaignForm: document.getElementById('campaignForm'),
    campaignName: document.getElementById('campaignName'),
    campaignAudience: document.getElementById('campaignAudience'),
    audienceWorkspaceSelect: document.getElementById('audienceWorkspaceSelect'),
    audienceWorkspaceStatus: document.getElementById('audienceWorkspaceStatus'),
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
    sequenceStepList: document.getElementById('sequenceStepList'),
    sequenceStepEditor: document.getElementById('sequenceStepEditor'),
    sequenceStepName: document.getElementById('sequenceStepName'),
    sequenceStepCondition: document.getElementById('sequenceStepCondition'),
    sequenceDelayValue: document.getElementById('sequenceDelayValue'),
    sequenceDelayUnit: document.getElementById('sequenceDelayUnit'),
    sequenceStopOnConversion: document.getElementById('sequenceStopOnConversion'),
    sequenceStopOnUnsubscribe: document.getElementById('sequenceStopOnUnsubscribe'),
    sequenceStopOnBounce: document.getElementById('sequenceStopOnBounce'),
    sequenceStepSummary: document.getElementById('sequenceStepSummary'),
    addSequenceStepBtn: document.getElementById('addSequenceStepBtn'),
    designSequenceStepBtn: document.getElementById('designSequenceStepBtn'),
    visualModeBtn: document.getElementById('visualModeBtn'),
    htmlModeBtn: document.getElementById('htmlModeBtn'),
    visualBuilder: document.getElementById('visualBuilder'),
    htmlBuilder: document.getElementById('htmlBuilder'),
    visualPreview: document.getElementById('visualPreview'),
    campaignPreviewCanvas: document.getElementById('campaignPreviewCanvas'),
    desktopPreviewBtn: document.getElementById('desktopPreviewBtn'),
    mobilePreviewBtn: document.getElementById('mobilePreviewBtn'),
    htmlEditor: document.getElementById('htmlEditor'),
    htmlPreview: document.getElementById('htmlPreview'),
    campaignList: document.getElementById('campaignList'),
    campaignSearchInput: document.getElementById('campaignSearchInput'),
    campaignStatusFilter: document.getElementById('campaignStatusFilter'),
    campaignListSummary: document.getElementById('campaignListSummary'),
    selectedCampaignSummary: document.getElementById('selectedCampaignSummary'),
    audienceList: document.getElementById('audienceList'),
    templateList: document.getElementById('templateList'),
    templateSearchInput: document.getElementById('templateSearchInput'),
    templateCategoryFilter: document.getElementById('templateCategoryFilter'),
    senderHealthList: document.getElementById('senderHealthList'),
    audienceUploadForm: document.getElementById('audienceUploadForm'),
    audienceName: document.getElementById('audienceName'),
    audienceDescription: document.getElementById('audienceDescription'),
    audienceFile: document.getElementById('audienceFile'),
    audienceSheetGroup: document.getElementById('audienceSheetGroup'),
    audienceSheetSelect: document.getElementById('audienceSheetSelect'),
    audienceConsentBasis: document.getElementById('audienceConsentBasis'),
    audienceConsentConfirmed: document.getElementById('audienceConsentConfirmed'),
    audienceConsentNote: document.getElementById('audienceConsentNote'),
    audiencePreviewBtn: document.getElementById('audiencePreviewBtn'),
    audienceImportBtn: document.getElementById('audienceImportBtn'),
    audienceResetBtn: document.getElementById('audienceResetBtn'),
    audienceImportStatus: document.getElementById('audienceImportStatus'),
    audienceMappingPanel: document.getElementById('audienceMappingPanel'),
    audienceColumnMapping: document.getElementById('audienceColumnMapping'),
    audiencePreviewMeta: document.getElementById('audiencePreviewMeta'),
    audiencePreviewTable: document.getElementById('audiencePreviewTable'),
    audienceDerivedVariables: document.getElementById('audienceDerivedVariables'),
    customerSearchInput: document.getElementById('customerSearchInput'),
    customerSearchBtn: document.getElementById('customerSearchBtn'),
    selectVisibleCustomersBtn: document.getElementById('selectVisibleCustomersBtn'),
    clearCustomersBtn: document.getElementById('clearCustomersBtn'),
    customerSelectionCount: document.getElementById('customerSelectionCount'),
    customerContactList: document.getElementById('customerContactList'),
    customerAudienceName: document.getElementById('customerAudienceName'),
    customerConsentBasis: document.getElementById('customerConsentBasis'),
    customerConsentConfirmed: document.getElementById('customerConsentConfirmed'),
    customerConsentNote: document.getElementById('customerConsentNote'),
    createCustomerAudienceBtn: document.getElementById('createCustomerAudienceBtn'),
    customerAudienceStatus: document.getElementById('customerAudienceStatus'),
    campaignReviewChecklist: document.getElementById('campaignReviewChecklist'),
    campaignReviewHighlights: document.getElementById('campaignReviewHighlights'),
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
    campaignStatHealthySenders: document.getElementById('campaignStatHealthySenders'),
    campaignStepPrevBtn: document.getElementById('campaignStepPrevBtn'),
    campaignStepNextBtn: document.getElementById('campaignStepNextBtn'),
    stepTabs: Array.from(document.querySelectorAll('[data-workspace-step-target]')),
    stepPanels: Array.from(document.querySelectorAll('[data-workspace-step-panel]'))
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
        imageUrl: 'https://auth.seemplifyai.com/images/campaigns/seemplify-platform-gloss.jpg',
        imageAlt: 'Connected Seemplify people operations platform',
        ctaLabel: 'Start free trial',
        ctaUrl: 'https://auth.seemplifyai.com/signup',
        secondaryLabel: 'Book a demo',
        secondaryUrl: 'https://auth.seemplifyai.com/book-demo'
      },
      {
        id: uid('text'),
        type: 'text',
        title: 'Why teams switch',
        body: 'Bring the work around your people into one connected place, with clearer handoffs and less repeated admin.'
      },
      {
        id: uid('features'),
        type: 'features',
        title: 'What Seemplify improves',
        body: 'Start with the workflows your team needs today, then keep the same identity, context, and controls as you grow.',
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
        imageUrl: 'https://auth.seemplifyai.com/images/campaigns/seemplify-platform-gloss.jpg',
        imageAlt: 'Seemplify product visual',
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

    if (type === 'image') {
      return {
        id: uid('image'),
        type,
        imageUrl: 'https://auth.seemplifyai.com/images/campaigns/seemplify-platform-gloss.jpg',
        imageAlt: 'Seemplify product visual',
        caption: 'A connected operating system for the full people journey.'
      }
    }

    if (type === 'quote') {
      return {
        id: uid('quote'),
        type,
        body: 'Seemplify gives every team one clear path from hiring through payroll and performance.',
        attribution: 'People operations leader'
      }
    }

    if (type === 'spacer') {
      return {
        id: uid('spacer'),
        type,
        height: 32
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

  function normalizeTemplateContent(template) {
    const templateContent = template && typeof template.content === 'object' && template.content
      ? template.content
      : {}
    const designMode = String(templateContent.designMode || template?.designMode || 'visual').trim().toLowerCase() === 'html'
      ? 'html'
      : 'visual'
    const design = clone(templateContent.design || template?.design || { version: 1, blocks: defaultBlocks() })
    if (!Array.isArray(design.blocks) || design.blocks.length === 0) {
      design.blocks = defaultBlocks()
    }

    return {
      subject: String(templateContent.subject || template?.subject || '{{ contact.FIRSTNAME }}, simplify HR operations with Seemplify').trim(),
      previewText: String(templateContent.previewText || template?.previewText || 'One operating system for recruiting, onboarding, approvals, payroll, and performance.').trim(),
      replyTo: String(templateContent.replyTo || template?.replyTo || '').trim().toLowerCase(),
      designMode,
      design,
      htmlContent: String(templateContent.htmlContent || template?.htmlContent || ''),
      textContent: String(templateContent.textContent || template?.textContent || '')
    }
  }

  function normalizeCampaignContent(content) {
    const source = content && typeof content === 'object' ? content : {}
    const normalized = normalizeTemplateContent({ content: source })
    normalized.template = source.template && typeof source.template === 'object'
      ? clone(source.template)
      : {}
    return normalized
  }

  function normalizeDraftSequence(draft) {
    const nextDraft = draft && typeof draft === 'object' ? draft : {}
    const rawSequence = nextDraft.sequence && typeof nextDraft.sequence === 'object' ? nextDraft.sequence : {}
    const rawSteps = Array.isArray(rawSequence.steps) && rawSequence.steps.length > 0
      ? rawSequence.steps
      : [{ name: 'Message 1', position: 0, delay: { value: 0, unit: 'minutes' }, condition: 'all', content: nextDraft.content }]
    const allowedConditions = new Set(['all', 'opened_previous', 'not_opened_previous', 'clicked_previous', 'not_clicked_previous'])
    const allowedUnits = new Set(['minutes', 'hours', 'days'])

    const steps = rawSteps
      .slice(0, 12)
      .map((step, index) => ({
        ...step,
        name: String(step?.name || `Message ${index + 1}`).trim(),
        position: index,
        delay: {
          value: index === 0 ? 0 : Math.max(0, Number(step?.delay?.value || 0)),
          unit: allowedUnits.has(step?.delay?.unit) ? step.delay.unit : (index === 0 ? 'minutes' : 'days')
        },
        condition: index === 0 || !allowedConditions.has(step?.condition) ? 'all' : step.condition,
        content: normalizeCampaignContent(step?.content || (index === 0 ? nextDraft.content : {}))
      }))

    nextDraft.sequence = {
      enabled: steps.length > 1 || Boolean(rawSequence.enabled),
      stopOnConversion: rawSequence.stopOnConversion !== false,
      stopOnUnsubscribe: true,
      stopOnBounce: true,
      steps
    }
    state.activeSequenceStepIndex = Math.min(Math.max(state.activeSequenceStepIndex || 0, 0), steps.length - 1)
    nextDraft.content = steps[state.activeSequenceStepIndex].content
    return nextDraft
  }

  function getActiveSequenceStep() {
    return state.draft?.sequence?.steps?.[state.activeSequenceStepIndex] || null
  }

  function createDraftFromTemplate(template) {
    const templateContent = normalizeTemplateContent(template)

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
        subject: templateContent.subject,
        previewText: templateContent.previewText,
        replyTo: templateContent.replyTo,
        designMode: templateContent.designMode,
        design: templateContent.design,
        htmlContent: templateContent.htmlContent,
        textContent: templateContent.textContent,
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

  function getDraftMode(draft) {
    return String(draft?.content?.designMode || '').trim().toLowerCase() === 'html' ? 'html' : 'visual'
  }

  function syncModeUi(mode) {
    const normalizedMode = mode === 'html' ? 'html' : 'visual'
    const isVisual = normalizedMode === 'visual'
    state.mode = normalizedMode
    if (state.draft?.content) {
      state.draft.content.designMode = normalizedMode
    }
    els.visualBuilder.style.display = isVisual ? '' : 'none'
    els.htmlBuilder.style.display = isVisual ? 'none' : ''
    els.visualModeBtn.classList.toggle('active', isVisual)
    els.htmlModeBtn.classList.toggle('active', !isVisual)
  }

  function setDraft(nextDraft, options = {}) {
    state.activeSequenceStepIndex = Number.isInteger(options.activeSequenceStepIndex) ? options.activeSequenceStepIndex : 0
    state.draft = normalizeDraftSequence(nextDraft)
    renderForm()
    renderSequenceBuilder()
    renderAudienceList()
    renderTemplateList()
    renderVisualPreview()
    renderHtmlEditor()
    updateActionState()
    renderSelectedCampaignSummary()
    renderReviewPanel()
    syncModeUi(getDraftMode(nextDraft))
  }

  function applyTemplateToActiveStep(template) {
    if (!template || !state.draft) return
    if (state.mode === 'visual') syncVisualStateFromDom()
    else state.draft.content.htmlContent = els.htmlEditor.value
    const content = normalizeTemplateContent(template)
    content.template = {
      templateId: template._id,
      name: template.name,
      slug: template.slug,
      category: template.category
    }
    const step = getActiveSequenceStep()
    if (step) step.content = content
    state.draft.content = content
    if (els.campaignTemplate) els.campaignTemplate.value = String(template._id || '')
    renderForm()
    renderTemplateList()
    renderVisualPreview()
    renderHtmlEditor()
    syncModeUi(getDraftMode(state.draft))
    renderSequenceBuilder()
    renderReviewPanel()
  }

  function formatSequenceDelay(step, index) {
    if (index === 0) return 'Sends when the campaign starts'
    const value = Math.max(0, Number(step?.delay?.value || 0))
    const unit = String(step?.delay?.unit || 'days')
    const conditionLabels = {
      all: 'everyone active',
      opened_previous: 'opened previous',
      not_opened_previous: 'did not open previous',
      clicked_previous: 'clicked previous',
      not_clicked_previous: 'did not click previous'
    }
    return `Wait ${value} ${unit} · ${conditionLabels[step?.condition] || conditionLabels.all}`
  }

  function syncSequenceControls() {
    const step = getActiveSequenceStep()
    if (!step) return
    step.name = String(els.sequenceStepName?.value || step.name || '').trim() || `Message ${state.activeSequenceStepIndex + 1}`
    step.condition = state.activeSequenceStepIndex === 0 ? 'all' : String(els.sequenceStepCondition?.value || 'all')
    step.delay = {
      value: state.activeSequenceStepIndex === 0 ? 0 : Math.max(0, Number(els.sequenceDelayValue?.value || 0)),
      unit: state.activeSequenceStepIndex === 0 ? 'minutes' : String(els.sequenceDelayUnit?.value || 'days')
    }
    state.draft.sequence.stopOnConversion = Boolean(els.sequenceStopOnConversion?.checked)
    state.draft.sequence.stopOnUnsubscribe = true
    state.draft.sequence.stopOnBounce = true
    state.draft.sequence.enabled = state.draft.sequence.steps.length > 1
  }

  function syncActiveMessageBeforeSwitch() {
    if (!state.draft?.content) return
    if (state.mode === 'visual') {
      syncVisualStateFromDom()
    } else if (els.htmlEditor) {
      state.draft.content.htmlContent = els.htmlEditor.value
    }
    syncDraftFromForm()
    syncSequenceControls()
    const activeStep = getActiveSequenceStep()
    if (activeStep) activeStep.content = state.draft.content
  }

  function setActiveSequenceStep(index, options = {}) {
    const steps = state.draft?.sequence?.steps || []
    if (steps.length === 0) return
    const nextIndex = Math.min(Math.max(Number(index || 0), 0), steps.length - 1)
    if (nextIndex !== state.activeSequenceStepIndex && options.sync !== false) {
      syncActiveMessageBeforeSwitch()
    }
    state.activeSequenceStepIndex = nextIndex
    state.draft.content = steps[nextIndex].content
    renderForm()
    renderSequenceBuilder()
    renderVisualPreview()
    renderHtmlEditor()
    syncModeUi(getDraftMode(state.draft))
    renderReviewPanel()
  }

  function renderSequenceBuilder() {
    if (!els.sequenceStepList || !state.draft?.sequence) return
    const steps = state.draft.sequence.steps || []
    els.sequenceStepList.innerHTML = steps.map((step, index) => `
      <div class="campaign-sequence-card ${index === state.activeSequenceStepIndex ? 'is-active' : ''}" data-select-sequence-step="${index}" role="button" tabindex="0">
        <span class="campaign-sequence-number">${index + 1}</span>
        <span class="campaign-sequence-copy">
          <strong>${escapeHtml(step.name || `Message ${index + 1}`)}</strong>
          <span>${escapeHtml(formatSequenceDelay(step, index))}</span>
        </span>
        ${steps.length > 1 ? `<button class="campaign-sequence-remove" type="button" data-remove-sequence-step="${index}" aria-label="Remove message">×</button>` : '<span></span>'}
      </div>
    `).join('')

    const active = getActiveSequenceStep()
    if (!active) return
    els.sequenceStepName.value = active.name || `Message ${state.activeSequenceStepIndex + 1}`
    els.sequenceStepCondition.value = active.condition || 'all'
    els.sequenceDelayValue.value = Number(active.delay?.value || 0)
    els.sequenceDelayUnit.value = active.delay?.unit || (state.activeSequenceStepIndex === 0 ? 'minutes' : 'days')
    const isFirst = state.activeSequenceStepIndex === 0
    els.sequenceStepCondition.disabled = isFirst
    els.sequenceDelayValue.disabled = isFirst
    els.sequenceDelayUnit.disabled = isFirst
    els.sequenceStopOnConversion.checked = state.draft.sequence.stopOnConversion !== false
    els.sequenceStopOnUnsubscribe.checked = true
    els.sequenceStopOnBounce.checked = true
    els.sequenceStopOnUnsubscribe.disabled = true
    els.sequenceStopOnBounce.disabled = true
    els.sequenceStepSummary.textContent = `${steps.length} message${steps.length === 1 ? '' : 's'} · editing ${state.activeSequenceStepIndex + 1} of ${steps.length}`
  }

  function addSequenceStep() {
    syncActiveMessageBeforeSwitch()
    const steps = state.draft.sequence.steps
    if (steps.length >= 12) throw new Error('A sequence can contain up to 12 messages.')
    const content = clone(state.draft.content)
    content.subject = `A quick follow-up: ${String(content.subject || 'Seemplify').replace(/^A quick follow-up:\s*/i, '')}`
    content.previewText = 'A useful next step from Seemplify.'
    steps.push({
      name: `Follow-up ${steps.length}`,
      position: steps.length,
      delay: { value: 2, unit: 'days' },
      condition: 'all',
      content
    })
    state.draft.sequence.enabled = true
    setActiveSequenceStep(steps.length - 1, { sync: false })
  }

  function removeSequenceStep(index) {
    const steps = state.draft?.sequence?.steps || []
    if (steps.length <= 1) return
    syncActiveMessageBeforeSwitch()
    steps.splice(index, 1)
    steps.forEach((step, stepIndex) => { step.position = stepIndex })
    state.draft.sequence.enabled = steps.length > 1
    setActiveSequenceStep(Math.min(state.activeSequenceStepIndex, steps.length - 1), { sync: false })
  }

  function renderStats() {
    if (!els.campaignStatTotal || !els.campaignStatAudiences || !els.campaignStatTemplates || !els.campaignStatHealthySenders) {
      return
    }
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

  function renderReviewPanel() {
    if (!els.campaignReviewChecklist || !els.campaignReviewHighlights || !state.draft) return

    const audience = state.audiences.find((entry) => String(entry._id) === String(state.draft.audience || ''))
    const templateName = state.draft?.content?.template?.name || 'Custom content'
    const sequenceSteps = state.draft?.sequence?.steps || []
    const hasContent = sequenceSteps.length > 0 && sequenceSteps.every((step) => (
      Boolean(String(step?.content?.htmlContent || '').trim()) ||
      (Array.isArray(step?.content?.design?.blocks) && step.content.design.blocks.length > 0)
    ))
    const hasComplianceFooter = sequenceSteps.length > 0 && sequenceSteps.every((step) => {
      const source = step?.content?.designMode === 'html'
        ? String(step?.content?.htmlContent || '')
        : JSON.stringify(step?.content?.design || {})
      return /\{\{\s*unsubscribe\s*\}\}/i.test(source)
    })
    const hasSender = isValidEmail(state.draft?.sender?.email || '')
    const hasAudience = Boolean(state.draft?.audience)
    const hasAudienceConsent = Boolean(audience?.consent?.confirmedAt) && audience?.consent?.basis !== 'not_recorded'
    const hasSubject = sequenceSteps.length > 0 && sequenceSteps.every((step) => Boolean(String(step?.content?.subject || '').trim()))
    const hasTests = Array.isArray(state.draft?.testSendEmails) && state.draft.testSendEmails.length > 0

    const checks = [
      {
        title: 'Campaign basics',
        ok: Boolean(String(state.draft?.name || '').trim()) && hasSubject,
        help: 'Set the campaign name and subject before you move into send testing.'
      },
      {
        title: 'Sender readiness',
        ok: hasSender,
        help: 'Use a valid sender email so tests and launch can run cleanly.'
      },
      {
        title: 'Message content',
        ok: hasContent,
        help: 'Every sequence message needs visual blocks or HTML content.'
      },
      {
        title: 'Sequence exits',
        ok: Boolean(state.draft?.sequence?.stopOnUnsubscribe) && Boolean(state.draft?.sequence?.stopOnBounce),
        help: 'Unsubscribe and bounce exits should remain enabled for safe follow-up delivery.'
      },
      {
        title: 'Compliance footer',
        ok: hasComplianceFooter,
        help: 'Every message needs the unsubscribe merge tag before it can launch.'
      },
      {
        title: 'Audience attached',
        ok: hasAudience,
        help: 'Select an audience or import one in the Audience step before launch.'
      },
      {
        title: 'Contact basis documented',
        ok: hasAudience && hasAudienceConsent,
        help: 'Every imported or customer audience needs a confirmed contact basis before launch.'
      },
      {
        title: 'Test recipients',
        ok: hasTests,
        help: 'Recommended before launch. Add one or more test emails in Setup.'
      }
    ]

    els.campaignReviewChecklist.innerHTML = checks.map((check) => `
      <div class="campaign-check-item">
        <div class="campaign-check-copy">
          <div class="campaign-check-title">${escapeHtml(check.title)}</div>
          <div class="campaign-check-help">${escapeHtml(check.help)}</div>
        </div>
        <span class="campaign-pill ${check.ok ? 'green' : 'amber'}">${check.ok ? 'Ready' : 'Needs attention'}</span>
      </div>
    `).join('')

    els.campaignReviewHighlights.innerHTML = `
      <div class="campaign-review-meta-item">
        <strong>Template</strong>
        <span>${escapeHtml(templateName)}</span>
      </div>
      <div class="campaign-review-meta-item">
        <strong>Audience</strong>
        <span>${escapeHtml(audience?.name || 'No audience selected')}</span>
      </div>
      <div class="campaign-review-meta-item">
        <strong>Sender</strong>
        <span>${escapeHtml(state.draft?.sender?.email || 'Not set')}</span>
      </div>
      <div class="campaign-review-meta-item">
        <strong>Editor Mode</strong>
        <span>${escapeHtml(getDraftMode(state.draft) === 'html' ? 'HTML' : 'Visual')}</span>
      </div>
      <div class="campaign-review-meta-item">
        <strong>Sequence</strong>
        <span>${sequenceSteps.length} message${sequenceSteps.length === 1 ? '' : 's'}${sequenceSteps.length > 1 ? ' with timed follow-ups' : ''}</span>
      </div>
      <div class="campaign-review-meta-item">
        <strong>Preview Text</strong>
        <span>${escapeHtml(state.draft?.content?.previewText || 'Not set')}</span>
      </div>
      <div class="campaign-review-meta-item">
        <strong>Test Recipients</strong>
        <span>${Array.isArray(state.draft?.testSendEmails) && state.draft.testSendEmails.length > 0 ? escapeHtml(state.draft.testSendEmails.join(', ')) : 'Not set'}</span>
      </div>
    `
  }

  function getWorkspaceStepIndex(stepKey) {
    return CAMPAIGN_WORKSPACE_STEPS.findIndex((step) => step.key === stepKey)
  }

  function setActiveWorkspaceStep(stepKey) {
    if (!els.stepTabs.length || !els.stepPanels.length) return
    const nextIndex = getWorkspaceStepIndex(stepKey)
    if (nextIndex < 0) return

    state.activeStep = stepKey

    els.stepTabs.forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-workspace-step-target') === stepKey)
    })

    els.stepPanels.forEach((panel) => {
      panel.classList.toggle('is-active', panel.getAttribute('data-workspace-step-panel') === stepKey)
    })

    if (els.campaignStepPrevBtn) {
      els.campaignStepPrevBtn.disabled = nextIndex === 0
    }

    if (els.campaignStepNextBtn) {
      const isLastStep = nextIndex === CAMPAIGN_WORKSPACE_STEPS.length - 1
      const nextLabel = isLastStep ? 'Stay on Review' : `Next: ${CAMPAIGN_WORKSPACE_STEPS[nextIndex + 1].label}`
      els.campaignStepNextBtn.textContent = nextLabel
      els.campaignStepNextBtn.disabled = isLastStep
    }

    if (stepKey === 'audience' && state.customerContacts.length === 0) {
      refreshCustomerContacts().catch((error) => setCustomerAudienceStatus(error.message || 'Failed to load customer contacts.', 'error'))
    }
  }

  function renderAudienceOptions() {
    const blankOption = state.audiences.length === 0
      ? '<option value="">No audiences uploaded yet</option>'
      : '<option value="">— select an audience —</option>'
    const options = blankOption + state.audiences.map((audience) => `<option value="${escapeHtml(audience._id)}">${escapeHtml(audience.name)} (${Number(audience.contactCount || audience.contacts?.length || 0)})</option>`).join('')
    const selectedAudienceId = String(state.draft?.audience || '')
    ;[els.campaignAudience, els.audienceWorkspaceSelect].filter(Boolean).forEach((select) => {
      select.innerHTML = options
      select.value = selectedAudienceId
    })
  }

  function selectCampaignAudience(audienceId, announce = false) {
    if (!state.draft) return
    state.draft.audience = String(audienceId || '')
    ;[els.campaignAudience, els.audienceWorkspaceSelect].filter(Boolean).forEach((select) => {
      select.value = state.draft.audience
    })
    renderAudienceList()
    renderSelectedCampaignSummary()
    renderReviewPanel()
    if (announce && els.audienceWorkspaceStatus) {
      const audience = state.audiences.find((item) => String(item._id) === state.draft.audience)
      els.audienceWorkspaceStatus.textContent = audience
        ? `${audience.name} is attached to this campaign.`
        : 'No audience is attached to this campaign.'
      els.audienceWorkspaceStatus.classList.toggle('success', Boolean(audience))
    }
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
      if (els.audienceWorkspaceSelect) els.audienceWorkspaceSelect.value = String(draft.audience)
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
    if (!els.campaignList) return
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
            <span class="admin-card-subtitle">Sequence: ${Number(campaign?.sequence?.steps?.length || 1)} message${Number(campaign?.sequence?.steps?.length || 1) === 1 ? '' : 's'}</span>
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
    if (!els.audienceList) return
    if (state.audiences.length === 0) {
      els.audienceList.innerHTML = '<div class="campaign-empty-state">Import a CSV or Excel file in the audience studio to create your first reusable audience.</div>'
      return
    }

    const currentAudienceId = String(state.draft?.audience || '')
    els.audienceList.innerHTML = state.audiences.map((audience) => {
      const isAttached = String(audience._id) === currentAudienceId
      return `
        <article class="campaign-audience-card">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div style="font-weight:700; color:var(--text);">${escapeHtml(audience.name)}</div>
            <button class="btn btn-sm ${isAttached ? 'btn-success' : 'btn-secondary'}" type="button" data-attach-audience="${escapeHtml(audience._id)}" style="flex-shrink:0;">${isAttached ? 'Attached' : 'Use'}</button>
          </div>
          <div class="admin-card-subtitle">${escapeHtml(audience.description || audience.sourceFileName || 'Imported audience')}</div>
          <div class="admin-card-subtitle">${Number(audience.contactCount || audience.contacts?.length || 0)} contacts | ${Number(audience.importSummary?.invalidRecipients || 0)} invalid | ${Number(audience.importSummary?.duplicateRecipients || 0)} duplicates</div>
        </article>
      `
    }).join('')
  }

  function renderTemplateList() {
    if (!els.templateList) return
    if (state.templates.length === 0) {
      els.templateList.innerHTML = '<div class="campaign-empty-state">No templates available.</div>'
      return
    }

    const query = String(state.templateSearch || '').trim().toLowerCase()
    const categoryFilter = String(state.templateCategoryFilter || 'all')
    const selectedTemplateId = String(state.draft?.content?.template?.templateId || state.draft?.content?.template?._id || '')
    const templates = state.templates.filter((template) => {
      const category = String(template.category || '').toLowerCase()
      const isProduct = category === 'product_marketing' || category === 'product_launch'
      const matchesCategory = categoryFilter === 'all' || (categoryFilter === 'product' ? isProduct : !isProduct)
      if (!matchesCategory) return false
      if (!query) return true
      return [template.name, template.description, template.category, ...(Array.isArray(template.tags) ? template.tags : [])]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })

    if (templates.length === 0) {
      els.templateList.innerHTML = '<div class="campaign-empty-state">No templates match this search.</div>'
      return
    }

    const categoryLabel = (category = '') => String(category || 'Custom')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())

    els.templateList.innerHTML = templates.map((template) => {
      const design = template?.content?.design || template?.design || {}
      const blocks = Array.isArray(design.blocks) ? design.blocks : []
      const artworkBlock = blocks.find((block) => block?.imageUrl) || {}
      const artwork = String(artworkBlock.imageUrl || '')
      const isSelected = String(template._id) === selectedTemplateId
      return `
        <article class="campaign-template-card ${isSelected ? 'is-selected' : ''}">
          <div class="campaign-template-card-preview"${artwork ? ` style="background-image:url('${escapeHtml(artwork)}')"` : ''}>
            <div class="campaign-template-brand-bar">
              <img src="/images/seemplifylogo.png" alt="Seemplify">
              <span>Designed email</span>
            </div>
          </div>
          <div class="campaign-template-card-body">
            <div class="campaign-template-card-copy">
              <div class="campaign-template-card-title">${escapeHtml(template.name)}</div>
              <div class="campaign-template-card-description">${escapeHtml(template.description || '')}</div>
              <div class="campaign-template-card-category">${escapeHtml(categoryLabel(template.category))}</div>
            </div>
            <button class="btn ${isSelected ? 'btn-primary' : 'btn-secondary'} btn-sm" type="button" data-apply-template="${escapeHtml(template._id)}">${isSelected ? 'Selected' : 'Use'}</button>
          </div>
        </article>
      `
    }).join('')
  }

  function renderSenderHealth() {
    if (!els.senderHealthList) return
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

  function getAudienceFieldDefinition(fieldKey) {
    return state.audienceFields.find((field) => String(field.key) === String(fieldKey)) || null
  }

  function getAudienceFieldVariableMeta(fieldKey) {
    return AUDIENCE_FIELD_VARIABLES[fieldKey] || { tokens: [], note: '' }
  }

  function getAudiencePreviewSampleValue(preview, header) {
    if (!preview || !Array.isArray(preview.headers) || !Array.isArray(preview.sampleRows)) return ''
    const headerIndex = preview.headers.findIndex((entry) => String(entry) === String(header))
    if (headerIndex < 0) return ''
    for (const row of preview.sampleRows) {
      const value = String((row && row[headerIndex]) || '').trim()
      if (value) {
        return value
      }
    }
    return ''
  }

  function renderAudienceDerivedVariables(preview) {
    if (!els.audienceDerivedVariables) return

    els.audienceDerivedVariables.innerHTML = DERIVED_VARIABLES.map((item) => {
      const mappedSources = (item.sourceFields || [])
        .map((fieldKey) => {
          const field = getAudienceFieldDefinition(fieldKey)
          const mappedHeader = preview?.columnMap?.[fieldKey] || ''
          if (!field || !mappedHeader) return ''
          return `${field.label}: ${mappedHeader}`
        })
        .filter(Boolean)

      const waitingFields = (item.sourceFields || [])
        .map((fieldKey) => {
          const field = getAudienceFieldDefinition(fieldKey)
          const mappedHeader = preview?.columnMap?.[fieldKey] || ''
          if (!field || mappedHeader) return ''
          return field.label
        })
        .filter(Boolean)

      return `
        <div class="campaign-variable-card ${mappedSources.length === 0 && (item.sourceFields || []).length > 0 ? 'is-missing' : ''}">
          <div class="campaign-variable-header">
            <div class="campaign-variable-title">${escapeHtml(item.label)}</div>
            ${mappedSources.length > 0
              ? '<span class="campaign-pill green">Ready</span>'
              : ((item.sourceFields || []).length > 0 ? '<span class="campaign-pill amber">Needs mapped fields</span>' : '<span class="campaign-pill blue">System</span>')}
          </div>
          <div class="campaign-token-list">
            ${(item.tokens || []).map((token) => `<span class="campaign-token">${escapeHtml(token)}</span>`).join('')}
          </div>
          <div class="campaign-variable-meta">
            <div>${escapeHtml(item.description || '')}</div>
            ${mappedSources.length > 0 ? `<div>Using mapped columns: <span class="campaign-variable-source">${escapeHtml(mappedSources.join(', '))}</span></div>` : ''}
            ${waitingFields.length > 0 ? `<div class="campaign-variable-empty">Waiting for mapped columns: ${escapeHtml(waitingFields.join(', '))}</div>` : ''}
          </div>
        </div>
      `
    }).join('')
  }

  function renderAudiencePreview() {
    const preview = state.audiencePreview

    if (!preview) {
      if (els.audienceSheetGroup) els.audienceSheetGroup.style.display = 'none'
      if (els.audienceMappingPanel) els.audienceMappingPanel.style.display = 'none'
      if (els.audiencePreviewMeta) els.audiencePreviewMeta.innerHTML = ''
      if (els.audienceColumnMapping) els.audienceColumnMapping.innerHTML = ''
      if (els.audiencePreviewTable) els.audiencePreviewTable.innerHTML = ''
      if (els.audienceDerivedVariables) els.audienceDerivedVariables.innerHTML = ''
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
          <div class="campaign-token-list">
            ${(getAudienceFieldVariableMeta(field.key).tokens || []).map((token) => `<span class="campaign-token">${escapeHtml(token)}</span>`).join('')}
          </div>
          <div class="campaign-variable-meta">
            <div class="campaign-variable-empty" data-audience-source="${escapeHtml(field.key)}">Not mapped yet. Choose a column to populate this variable.</div>
            <div class="campaign-variable-empty" data-audience-sample="${escapeHtml(field.key)}"></div>
            ${getAudienceFieldVariableMeta(field.key).note ? `<div>${escapeHtml(getAudienceFieldVariableMeta(field.key).note)}</div>` : ''}
          </div>
        </div>
      `).join('')

      Array.from(els.audienceColumnMapping.querySelectorAll('[data-audience-map]')).forEach((select) => {
        const key = select.getAttribute('data-audience-map')
        select.value = preview.columnMap?.[key] || ''
      })

      state.audienceFields.forEach((field) => {
        const mappedHeader = preview.columnMap?.[field.key] || ''
        const sourceEl = els.audienceColumnMapping.querySelector(`[data-audience-source="${field.key}"]`)
        const sampleEl = els.audienceColumnMapping.querySelector(`[data-audience-sample="${field.key}"]`)
        const sampleValue = mappedHeader ? getAudiencePreviewSampleValue(preview, mappedHeader) : ''

        if (sourceEl) {
          sourceEl.innerHTML = mappedHeader
            ? `Mapped from: <span class="campaign-variable-source">${escapeHtml(mappedHeader)}</span>`
            : 'Not mapped yet. Choose a column to populate this variable.'
        }

        if (sampleEl) {
          sampleEl.innerHTML = sampleValue
            ? `Sample value: <span class="campaign-variable-source">${escapeHtml(sampleValue)}</span>`
            : ''
        }
      })
    }

    renderAudienceDerivedVariables(preview)

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
    setAudienceStatus(`Extracted ${Number(state.audiencePreview?.totalRows || 0)} rows from ${file.name}. Map the fields, then use the merge tags shown on each card.`, 'success')
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
    if (!els.audienceConsentConfirmed?.checked) {
      throw new Error('Confirm the contact basis before importing this audience.')
    }

    const data = new FormData()
    data.append('file', file)
    data.append('name', els.audienceName.value.trim() || getAudienceFileBaseName(file.name))
    data.append('description', els.audienceDescription.value.trim())
    data.append('columnMap', JSON.stringify(columnMap))
    data.append('consentBasis', els.audienceConsentBasis.value)
    data.append('consentConfirmed', 'true')
    data.append('consentNote', String(els.audienceConsentNote?.value || '').trim())
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
      selectCampaignAudience(result.audience._id, true)
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
            ${block.imageUrl ? `<img class="campaign-preview-image" src="${escapeHtml(block.imageUrl)}" alt="${escapeHtml(block.imageAlt || '')}">` : ''}
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
            <div class="campaign-mini-grid">
              <input class="campaign-mini-input" data-input-field="imageUrl" value="${escapeHtml(block.imageUrl || '')}" placeholder="Hero image URL">
              <input class="campaign-mini-input" data-input-field="imageAlt" value="${escapeHtml(block.imageAlt || '')}" placeholder="Image description">
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

    if (block.type === 'image') {
      return `
        <div class="campaign-block" draggable="true" data-block-id="${escapeHtml(block.id)}">
          ${commonToolbar}
          <div class="campaign-block-body" data-type="image">
            ${block.imageUrl ? `<img class="campaign-preview-image" src="${escapeHtml(block.imageUrl)}" alt="${escapeHtml(block.imageAlt || '')}">` : '<div class="campaign-empty-state">Add an image URL below.</div>'}
            <div class="campaign-preview-subtitle campaign-preview-editable" contenteditable="true" data-field="caption">${block.caption || ''}</div>
            <div class="campaign-mini-grid">
              <input class="campaign-mini-input" data-input-field="imageUrl" value="${escapeHtml(block.imageUrl || '')}" placeholder="Image URL">
              <input class="campaign-mini-input" data-input-field="imageAlt" value="${escapeHtml(block.imageAlt || '')}" placeholder="Image description">
            </div>
          </div>
        </div>
      `
    }

    if (block.type === 'quote') {
      return `
        <div class="campaign-block" draggable="true" data-block-id="${escapeHtml(block.id)}">
          ${commonToolbar}
          <div class="campaign-block-body" data-type="quote" style="border-left:4px solid #7047eb;">
            <div class="campaign-preview-title campaign-preview-editable" contenteditable="true" data-field="body">${block.body || ''}</div>
            <div class="campaign-preview-subtitle campaign-preview-editable" contenteditable="true" data-field="attribution">${block.attribution || ''}</div>
          </div>
        </div>
      `
    }

    if (block.type === 'spacer') {
      return `
        <div class="campaign-block" draggable="true" data-block-id="${escapeHtml(block.id)}">
          ${commonToolbar}
          <div class="campaign-block-body" data-type="spacer">
            <label class="admin-form-label">Spacer height</label>
            <input class="campaign-mini-input" type="number" min="8" max="160" data-input-field="height" value="${Number(block.height || 32)}">
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
    renderReviewPanel()
  }

  function renderEmailHtmlFromBlocks() {
    const blocks = Array.isArray(state.draft.content?.design?.blocks) ? state.draft.content.design.blocks : []
    const sections = blocks.map((block) => {
      if (block.type === 'divider') {
        return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="height:1px;background:#ded9e8;font-size:0;line-height:0;">&nbsp;</td></tr></table>'
      }
      if (block.type === 'spacer') {
        const height = Math.min(Math.max(Number(block.height || 32), 8), 160)
        return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td height="${height}" style="height:${height}px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`
      }
      if (block.type === 'hero') {
        return `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#18161f;border-radius:10px;overflow:hidden;color:#ffffff;">
            ${block.imageUrl ? `<tr><td><img src="${escapeHtml(block.imageUrl)}" alt="${escapeHtml(block.imageAlt || '')}" width="680" style="display:block;width:100%;max-width:680px;height:auto;border:0;"></td></tr>` : ''}
            <tr><td style="padding:32px;">
              <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#d9cff8;">${block.eyebrow || ''}</div>
              <h1 style="margin:14px 0;font-size:34px;line-height:1.08;color:#ffffff;">${block.title || ''}</h1>
              <div style="font-size:15px;line-height:1.7;color:#f5f1ff;">${block.body || ''}</div>
              ${block.ctaLabel ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;"><tr><td style="border-radius:7px;background:#f7f5fa;"><a href="${escapeHtml(block.ctaUrl || '#')}" style="display:inline-block;padding:13px 20px;color:#0f0e13;text-decoration:none;font-weight:700;">${block.ctaLabel}</a></td></tr></table>` : ''}
            </td></tr>
          </table>
        `
      }
      if (block.type === 'features') {
        return `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #e8e3ee;border-radius:12px;"><tr><td style="padding:26px;">
            <h2 style="margin:0 0 10px;font-size:24px;color:#221934;">${block.title || ''}</h2>
            <div style="font-size:15px;line-height:1.7;color:#514866;margin-bottom:12px;">${block.body || ''}</div>
            ${(block.items || []).map((item) => `<div style="padding:8px 0;color:#3f3656;line-height:1.6;"><span style="color:#7047eb;font-weight:700;">✓</span>&nbsp;&nbsp;${item}</div>`).join('')}
          </td></tr></table>
        `
      }
      if (block.type === 'cta') {
        return `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3efff;border:1px solid #ded3fb;border-radius:12px;"><tr><td style="padding:26px;">
            <h2 style="margin:0 0 10px;font-size:24px;color:#221934;">${block.title || ''}</h2>
            <div style="font-size:15px;line-height:1.7;color:#3f3656;margin-bottom:14px;">${block.body || ''}</div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:8px;background:#7047eb;"><a href="${escapeHtml(block.ctaUrl || '#')}" style="display:inline-block;padding:12px 18px;color:#fff;text-decoration:none;font-weight:700;">${block.ctaLabel || ''}</a></td></tr></table>
          </td></tr></table>
        `
      }
      if (block.type === 'image') {
        return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td>${block.imageUrl ? `<img src="${escapeHtml(block.imageUrl)}" alt="${escapeHtml(block.imageAlt || '')}" width="680" style="display:block;width:100%;max-width:680px;height:auto;border:0;border-radius:12px;">` : ''}${block.caption ? `<div style="padding:10px 4px 0;font-size:12px;line-height:1.6;color:#766c86;">${block.caption}</div>` : ''}</td></tr></table>`
      }
      if (block.type === 'quote') {
        return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border-left:4px solid #7047eb;"><tr><td style="padding:24px 26px;"><div style="font-size:21px;line-height:1.5;color:#221934;">“${block.body || ''}”</div><div style="margin-top:10px;font-size:13px;color:#766c86;">${block.attribution || ''}</div></td></tr></table>`
      }
      if (block.type === 'footer') {
        return `<footer style="font-size:12px;line-height:1.8;color:#6d6485;">${block.body || ''}</footer>`
      }
      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #e8e3ee;border-radius:12px;"><tr><td style="padding:26px;">
          <h2 style="margin:0 0 10px;font-size:24px;color:#221934;">${block.title || ''}</h2>
          <div style="font-size:15px;line-height:1.7;color:#3f3656;">${block.body || ''}</div>
        </td></tr></table>
      `
    }).join('<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td height="16" style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr></table>')

    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(state.draft.content.subject || 'Seemplify')}</title></head><body style="margin:0;padding:0;background:#0f0e13;font-family:Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(state.draft.content.previewText || '')}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0f0e13;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;"><tr><td style="padding:0 4px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="left"><img src="https://auth.seemplifyai.com/images/seemplifylogo.png" width="142" alt="Seemplify" style="display:block;width:142px;max-width:142px;height:auto;border:0;"></td><td align="right" style="color:#bbb5c2;font-size:12px;line-height:18px;">People operations, connected.</td></tr></table></td></tr><tr><td>${sections}</td></tr></table></td></tr></table></body></html>`
  }

  function renderHtmlEditor() {
    if (!state.draft.content.htmlContent) {
      state.draft.content.htmlContent = renderEmailHtmlFromBlocks()
    }
    els.htmlEditor.value = state.draft.content.htmlContent || ''
    els.htmlPreview.innerHTML = state.draft.content.htmlContent || ''
    renderReviewPanel()
  }

  function updateActionState() {
    const hasCampaign = Boolean(state.selectedCampaignId)
    if (els.campaignDetailLink) {
      els.campaignDetailLink.href = hasCampaign ? `/admin/campaigns/${encodeURIComponent(state.selectedCampaignId)}` : '#'
    }
    if (els.pauseCampaignBtn) els.pauseCampaignBtn.disabled = !hasCampaign
    if (els.resumeCampaignBtn) els.resumeCampaignBtn.disabled = !hasCampaign
    if (els.cancelCampaignBtn) els.cancelCampaignBtn.disabled = !hasCampaign
    if (els.launchCampaignBtn) els.launchCampaignBtn.disabled = false
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
    const activeStep = getActiveSequenceStep()
    if (activeStep) activeStep.content = state.draft.content
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

  function setCustomerAudienceStatus(message, tone) {
    if (!els.customerAudienceStatus) return
    els.customerAudienceStatus.textContent = message || ''
    els.customerAudienceStatus.classList.toggle('success', tone === 'success')
    els.customerAudienceStatus.classList.toggle('error', tone === 'error')
  }

  function updateCustomerSelectionCount() {
    if (els.customerSelectionCount) {
      const count = state.selectedCustomerIds.size
      els.customerSelectionCount.textContent = `${count} selected`
    }
  }

  function renderCustomerContacts() {
    if (!els.customerContactList) return
    if (state.customerContacts.length === 0) {
      els.customerContactList.innerHTML = '<div class="campaign-empty-state">No eligible customer contacts matched this search.</div>'
      updateCustomerSelectionCount()
      return
    }
    els.customerContactList.innerHTML = state.customerContacts.map((contact) => {
      const accountId = String(contact.accountId || '')
      const checked = state.selectedCustomerIds.has(accountId)
      const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email
      const meta = [contact.role, contact.planName || contact.subscriptionStatus].filter(Boolean).join(' · ')
      return `
        <label class="campaign-customer-row">
          <input type="checkbox" data-customer-id="${escapeHtml(accountId)}" ${checked ? 'checked' : ''}>
          <span class="campaign-customer-copy">
            <strong>${escapeHtml(name)}</strong>
            <span>${escapeHtml(contact.email)}${contact.companyName ? ` · ${escapeHtml(contact.companyName)}` : ''}</span>
          </span>
          <span class="campaign-customer-meta">${escapeHtml(meta)}</span>
        </label>
      `
    }).join('')
    updateCustomerSelectionCount()
  }

  async function refreshCustomerContacts() {
    const search = String(els.customerSearchInput?.value || '').trim()
    setCustomerAudienceStatus('Loading customer contacts…')
    const roles = 'owner,admin,hr_manager,recruiter,interviewer,staff'
    const response = await fetch(`/api/admin/campaign-customers?limit=200&roles=${encodeURIComponent(roles)}&search=${encodeURIComponent(search)}`)
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Failed to load customer contacts.')
    state.customerContacts = Array.isArray(payload.contacts) ? payload.contacts : []
    renderCustomerContacts()
    setCustomerAudienceStatus(`${state.customerContacts.length} eligible contact${state.customerContacts.length === 1 ? '' : 's'} loaded. Suppressed recipients will be excluded when the audience is created.`, 'success')
  }

  async function createCustomerAudience() {
    const accountIds = Array.from(state.selectedCustomerIds)
    const name = String(els.customerAudienceName?.value || '').trim()
    if (!name) throw new Error('Give the customer audience a name.')
    if (accountIds.length === 0) throw new Error('Select at least one customer contact.')
    if (!els.customerConsentConfirmed?.checked) throw new Error('Confirm the contact basis before creating this audience.')
    setCustomerAudienceStatus('Creating customer audience…')
    const response = await fetch('/api/admin/campaign-audiences/from-customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        accountIds,
        consentBasis: els.customerConsentBasis.value,
        consentConfirmed: true,
        consentNote: String(els.customerConsentNote?.value || '').trim()
      })
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Failed to create customer audience.')
    await refreshAudiences()
    if (payload.audience && state.draft) {
      selectCampaignAudience(payload.audience._id, true)
    }
    state.selectedCustomerIds.clear()
    renderCustomerContacts()
    setCustomerAudienceStatus(payload.message || 'Customer audience created and attached.', 'success')
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
    setActiveWorkspaceStep('setup')
    renderCampaignList()
  }

  function switchMode(mode) {
    const normalizedMode = mode === 'html' ? 'html' : 'visual'
    const previousMode = state.mode
    const hasVisualBlocks = Array.isArray(state.draft.content?.design?.blocks) && state.draft.content.design.blocks.length > 0

    if (normalizedMode === 'html') {
      if (previousMode === 'visual' && hasVisualBlocks) {
        syncVisualStateFromDom()
        state.draft.content.htmlContent = renderEmailHtmlFromBlocks()
      } else if (!String(state.draft.content?.htmlContent || '').trim() && hasVisualBlocks) {
        state.draft.content.htmlContent = renderEmailHtmlFromBlocks()
      }
      renderHtmlEditor()
    } else if (previousMode === 'html') {
      state.draft.content.htmlContent = els.htmlEditor.value
    }

    syncModeUi(normalizedMode)
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

  async function saveDraft(options = {}) {
    const activeSequenceStepIndex = state.activeSequenceStepIndex
    if (state.mode === 'visual') {
      syncVisualStateFromDom()
    } else {
      state.draft.content.htmlContent = els.htmlEditor.value
    }
    syncDraftFromForm()
    syncSequenceControls()

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
      testSendEmails: state.draft.testSendEmails,
      sequence: state.draft.sequence
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
    await Promise.all([refreshCampaigns(), refreshSenderHealth()])
    setDraft(result.campaign, { activeSequenceStepIndex })
    if (!options.silent) alert(result.message || 'Campaign saved.')
    return result.campaign
  }

  async function ensureSavedCampaign(options = {}) {
    if (!state.selectedCampaignId || options.force) {
      return saveDraft({ silent: options.silent !== false })
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
    await ensureSavedCampaign({ force: action === 'launch', silent: true })
    const response = await fetch(`/api/admin/campaigns/${encodeURIComponent(state.selectedCampaignId)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(extraPayload || {})
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || `Failed to ${action} campaign.`)
    await Promise.all([refreshCampaigns(), refreshSenderHealth()])
    setDraft(result.campaign)
    alert(result.message || `Campaign ${action}d.`)
  }

  function resetDraft() {
    if (workspaceMode === 'edit') {
      window.location.href = '/admin/campaigns/create'
      return
    }

    state.selectedCampaignId = ''
    setDraft(createDraftFromTemplate(getSelectedTemplate()))
    setActiveWorkspaceStep('setup')
    renderCampaignList()
  }

  async function uploadAudience(event) {
    await previewAudienceImport(event)
  }

  if (els.stepTabs.length > 0) {
    els.stepTabs.forEach((button) => {
      button.addEventListener('click', function () {
        setActiveWorkspaceStep(button.getAttribute('data-workspace-step-target'))
      })
    })
  }

  if (els.campaignStepPrevBtn) {
    els.campaignStepPrevBtn.addEventListener('click', function () {
      const currentIndex = getWorkspaceStepIndex(state.activeStep)
      if (currentIndex <= 0) return
      setActiveWorkspaceStep(CAMPAIGN_WORKSPACE_STEPS[currentIndex - 1].key)
    })
  }

  if (els.campaignStepNextBtn) {
    els.campaignStepNextBtn.addEventListener('click', function () {
      const currentIndex = getWorkspaceStepIndex(state.activeStep)
      if (currentIndex < 0 || currentIndex >= CAMPAIGN_WORKSPACE_STEPS.length - 1) return
      setActiveWorkspaceStep(CAMPAIGN_WORKSPACE_STEPS[currentIndex + 1].key)
    })
  }

  if (els.sequenceStepList) {
    els.sequenceStepList.addEventListener('click', function (event) {
      const removeButton = event.target.closest('[data-remove-sequence-step]')
      if (removeButton) {
        event.stopPropagation()
        removeSequenceStep(Number(removeButton.getAttribute('data-remove-sequence-step')))
        return
      }
      const card = event.target.closest('[data-select-sequence-step]')
      if (card) setActiveSequenceStep(Number(card.getAttribute('data-select-sequence-step')))
    })
    els.sequenceStepList.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const card = event.target.closest('[data-select-sequence-step]')
      if (!card) return
      event.preventDefault()
      setActiveSequenceStep(Number(card.getAttribute('data-select-sequence-step')))
    })
  }

  if (els.addSequenceStepBtn) {
    els.addSequenceStepBtn.addEventListener('click', function () {
      try { addSequenceStep() } catch (error) { alert(error.message || 'Failed to add sequence message.') }
    })
  }

  if (els.designSequenceStepBtn) {
    els.designSequenceStepBtn.addEventListener('click', function () {
      syncSequenceControls()
      renderSequenceBuilder()
      setActiveWorkspaceStep('content')
    })
  }

  ;[els.sequenceStepCondition, els.sequenceDelayValue, els.sequenceDelayUnit, els.sequenceStopOnConversion, els.sequenceStopOnUnsubscribe, els.sequenceStopOnBounce]
    .filter(Boolean)
    .forEach((control) => control.addEventListener('change', function () {
      syncSequenceControls()
      renderSequenceBuilder()
      renderReviewPanel()
    }))

  if (els.sequenceStepName) {
    els.sequenceStepName.addEventListener('input', function () {
      syncSequenceControls()
      const label = els.sequenceStepList.querySelector(`[data-select-sequence-step="${state.activeSequenceStepIndex}"] strong`)
      if (label) label.textContent = getActiveSequenceStep()?.name || `Message ${state.activeSequenceStepIndex + 1}`
    })
    els.sequenceStepName.addEventListener('blur', renderSequenceBuilder)
  }

  function setPreviewViewport(viewport) {
    const mobile = viewport === 'mobile'
    els.campaignPreviewCanvas?.classList.toggle('is-mobile', mobile)
    els.desktopPreviewBtn?.classList.toggle('active', !mobile)
    els.mobilePreviewBtn?.classList.toggle('active', mobile)
  }

  if (els.desktopPreviewBtn) els.desktopPreviewBtn.addEventListener('click', () => setPreviewViewport('desktop'))
  if (els.mobilePreviewBtn) els.mobilePreviewBtn.addEventListener('click', () => setPreviewViewport('mobile'))

  if (els.campaignForm) {
    const handleCampaignFormChange = function () {
      if (!state.draft) return
      syncDraftFromForm()
      renderSelectedCampaignSummary()
      renderReviewPanel()
    }
    els.campaignForm.addEventListener('input', handleCampaignFormChange)
    els.campaignForm.addEventListener('change', handleCampaignFormChange)
  }

  if (els.visualModeBtn) {
    els.visualModeBtn.addEventListener('click', function () {
      switchMode('visual')
    })
  }

  if (els.htmlModeBtn) {
    els.htmlModeBtn.addEventListener('click', function () {
      switchMode('html')
    })
  }

  if (els.newCampaignBtn) {
    els.newCampaignBtn.addEventListener('click', function () {
      resetDraft()
    })
  }

  if (els.saveCampaignBtn) {
    els.saveCampaignBtn.addEventListener('click', function () {
      saveDraft().catch((error) => alert(error.message || 'Failed to save draft.'))
    })
  }

  if (els.launchCampaignBtn) {
    els.launchCampaignBtn.addEventListener('click', function () {
      handleLifecycle('launch').catch((error) => alert(error.message || 'Failed to launch campaign.'))
    })
  }

  if (els.pauseCampaignBtn) {
    els.pauseCampaignBtn.addEventListener('click', function () {
      handleLifecycle('pause').catch((error) => alert(error.message || 'Failed to pause campaign.'))
    })
  }

  if (els.resumeCampaignBtn) {
    els.resumeCampaignBtn.addEventListener('click', function () {
      handleLifecycle('resume').catch((error) => alert(error.message || 'Failed to resume campaign.'))
    })
  }

  if (els.cancelCampaignBtn) {
    els.cancelCampaignBtn.addEventListener('click', function () {
      if (!window.confirm('Cancel this campaign and stop remaining batches?')) return
      handleLifecycle('cancel').catch((error) => alert(error.message || 'Failed to cancel campaign.'))
    })
  }

  if (els.sendTestBtn) {
    els.sendTestBtn.addEventListener('click', async function () {
      try {
        validateTestSendState()
        await ensureSavedCampaign({ force: true, silent: true })
        const emails = els.campaignTestEmails.value.trim()
        const activeStep = getActiveSequenceStep()
        const response = await fetch(`/api/admin/campaigns/${encodeURIComponent(state.selectedCampaignId)}/test-send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails, stepId: activeStep?._id || '' })
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
  }

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

  if (els.customerSearchBtn) {
    els.customerSearchBtn.addEventListener('click', function () {
      refreshCustomerContacts().catch((error) => setCustomerAudienceStatus(error.message || 'Failed to load customer contacts.', 'error'))
    })
  }

  if (els.customerSearchInput) {
    els.customerSearchInput.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return
      event.preventDefault()
      refreshCustomerContacts().catch((error) => setCustomerAudienceStatus(error.message || 'Failed to load customer contacts.', 'error'))
    })
  }

  if (els.customerContactList) {
    els.customerContactList.addEventListener('change', function (event) {
      const checkbox = event.target.closest('[data-customer-id]')
      if (!checkbox) return
      const accountId = checkbox.getAttribute('data-customer-id')
      if (checkbox.checked) state.selectedCustomerIds.add(accountId)
      else state.selectedCustomerIds.delete(accountId)
      updateCustomerSelectionCount()
    })
  }

  if (els.selectVisibleCustomersBtn) {
    els.selectVisibleCustomersBtn.addEventListener('click', function () {
      state.customerContacts.forEach((contact) => state.selectedCustomerIds.add(String(contact.accountId || '')))
      state.selectedCustomerIds.delete('')
      renderCustomerContacts()
    })
  }

  if (els.clearCustomersBtn) {
    els.clearCustomersBtn.addEventListener('click', function () {
      state.selectedCustomerIds.clear()
      renderCustomerContacts()
    })
  }

  if (els.createCustomerAudienceBtn) {
    els.createCustomerAudienceBtn.addEventListener('click', function () {
      createCustomerAudience().catch((error) => setCustomerAudienceStatus(error.message || 'Failed to create customer audience.', 'error'))
    })
  }

  if (els.audienceFile) {
    els.audienceFile.addEventListener('change', function () {
      state.audiencePreview = null
      renderAudiencePreview()
      if (els.audienceFile.files && els.audienceFile.files[0] && !els.audienceName.value.trim()) {
        els.audienceName.value = getAudienceFileBaseName(els.audienceFile.files[0].name)
      }
      setAudienceStatus('File selected. Click "Extract Fields" to inspect the headers, map each field, and see the merge tags.')
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

  if (els.templateSearchInput) {
    els.templateSearchInput.addEventListener('input', function () {
      state.templateSearch = els.templateSearchInput.value
      renderTemplateList()
    })
  }

  if (els.templateCategoryFilter) {
    els.templateCategoryFilter.addEventListener('change', function () {
      state.templateCategoryFilter = els.templateCategoryFilter.value || 'all'
      renderTemplateList()
    })
  }

  if (els.campaignTemplate) {
    els.campaignTemplate.addEventListener('change', function () {
      const template = getSelectedTemplate()
      if (!template) return
      applyTemplateToActiveStep(template)
    })
  }

  if (els.campaignAudience) {
    els.campaignAudience.addEventListener('change', function () {
      selectCampaignAudience(els.campaignAudience.value)
    })
  }

  if (els.audienceWorkspaceSelect) {
    els.audienceWorkspaceSelect.addEventListener('change', function () {
      selectCampaignAudience(els.audienceWorkspaceSelect.value, true)
    })
  }

  if (els.audienceList) {
    els.audienceList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-attach-audience]')
      if (!button) return
      const audienceId = button.getAttribute('data-attach-audience')
      if (!state.draft) return
      selectCampaignAudience(audienceId, true)
    })
  }

  if (els.campaignList) {
    els.campaignList.addEventListener('click', function (event) {
      const card = event.target.closest('[data-campaign-id]')
      if (!card) return
      loadCampaign(card.getAttribute('data-campaign-id')).catch((error) => alert(error.message || 'Failed to load campaign.'))
    })
  }

  if (els.templateList) {
    els.templateList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-apply-template]')
      if (!button) return
      const template = state.templates.find((item) => String(item._id) === String(button.getAttribute('data-apply-template')))
      if (!template) return
      applyTemplateToActiveStep(template)
      setActiveWorkspaceStep('content')
    })
  }

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
    const field = event.target.getAttribute('data-input-field')
    block[field] = field === 'height' ? Number(event.target.value || 32) : event.target.value
    if (field === 'imageUrl' || field === 'imageAlt') renderVisualPreview()
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
    renderReviewPanel()
  })

  els.htmlPreview.addEventListener('input', function () {
    state.draft.content.htmlContent = els.htmlPreview.innerHTML
    els.htmlEditor.value = state.draft.content.htmlContent
    renderReviewPanel()
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
  setDraft(initialSelectedCampaign ? clone(initialSelectedCampaign) : createDraftFromTemplate(state.templates[0] || null))
  setActiveWorkspaceStep('setup')
})()

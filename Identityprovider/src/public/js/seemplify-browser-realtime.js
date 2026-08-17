(function startSeemplifyBrowserRealtime() {
  'use strict'

  const script = document.currentScript
  const relayOrigin = script?.src ? new URL(script.src).origin : window.location.origin
  const state = { after: new Date(Date.now() - 30000).toISOString(), timer: null, workspaceOrigin: 'https://workspace.seemplifyai.com' }
  const callKinds = new Set(['direct_call', 'voice_invite', 'meeting_invite'])
  const cards = new Map()

  const workspaceUrl = (event, action) => {
    const destination = new URL(event.deepLink || '/messaging', state.workspaceOrigin)
    if (event.callId) destination.searchParams.set('callId', event.callId)
    if (action) destination.searchParams.set('callAction', action)
    return destination.href
  }

  const ensureHost = () => {
    let host = document.getElementById('seemplify-realtime-host')
    if (host) return host.shadowRoot
    host = document.createElement('div')
    host.id = 'seemplify-realtime-host'
    host.setAttribute('aria-live', 'assertive')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>
      :host{all:initial}.stack{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:grid;gap:10px;width:min(360px,calc(100vw - 28px));font:14px/1.4 Inter,system-ui,sans-serif}.card{color:#f7f7f8;background:#1c1b22;border:1px solid #3b3944;border-radius:12px;box-shadow:0 16px 42px rgba(0,0,0,.3);padding:15px}.meta{color:#aaa7b4;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.title{display:block;margin:4px 0 3px;font-size:15px}.body{margin:0;color:#cbc9d1;font-size:12px}.actions{display:flex;gap:8px;margin-top:13px}.actions button{border:1px solid #4a4755;border-radius:8px;padding:8px 12px;color:#f7f7f8;background:#292731;font:600 12px Inter,system-ui;cursor:pointer}.actions .accept{border-color:#6d4be8;background:#6d4be8}.actions .decline{color:#ffb4b4}.close{float:right;border:0;color:#aaa7b4;background:transparent;cursor:pointer;font-size:18px}</style><div class="stack" role="region" aria-label="Seemplify calls and notifications"></div>`
    document.body.appendChild(host)
    return root
  }

  const dismiss = (callId) => {
    const card = cards.get(callId)
    if (card) card.remove()
    cards.delete(callId)
  }

  const presentCall = (event) => {
    if (!event.callId || cards.has(event.callId)) return
    const root = ensureHost()
    const card = document.createElement('article')
    card.className = 'card'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-label', 'Incoming Seemplify call')
    const close = document.createElement('button')
    close.className = 'close'
    close.type = 'button'
    close.setAttribute('aria-label', 'Dismiss incoming call')
    close.textContent = '×'
    close.onclick = () => dismiss(event.callId)
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = 'Seemplify Workspace'
    const title = document.createElement('strong')
    title.className = 'title'
    title.textContent = event.title || 'Incoming call'
    const body = document.createElement('p')
    body.className = 'body'
    body.textContent = event.body || 'Open Workspace to answer.'
    const actions = document.createElement('div')
    actions.className = 'actions'
    const decline = document.createElement('button')
    decline.className = 'decline'
    decline.type = 'button'
    decline.textContent = 'Decline'
    decline.onclick = () => { dismiss(event.callId); window.open(workspaceUrl(event, 'decline'), '_blank', 'noopener') }
    const accept = document.createElement('button')
    accept.className = 'accept'
    accept.type = 'button'
    accept.textContent = 'Open call'
    accept.onclick = () => { dismiss(event.callId); window.open(workspaceUrl(event, 'accept'), '_blank', 'noopener') }
    actions.append(decline, accept)
    card.append(close, meta, title, body, actions)
    root.querySelector('.stack').appendChild(card)
    cards.set(event.callId, card)
  }

  const handleEvent = (event) => {
    if (event.kind === 'call_resolved' && event.callId) return dismiss(event.callId)
    if (callKinds.has(event.kind)) return presentCall(event)
    if (document.visibilityState !== 'visible' && window.Notification?.permission === 'granted') {
      const notice = new Notification(event.title || 'Seemplify activity', { body: event.body || '', tag: `seemplify:${event.eventId}`, silent: event.silent === true })
      notice.onclick = () => { window.open(workspaceUrl(event), '_blank', 'noopener'); notice.close() }
    }
  }

  const poll = async () => {
    try {
      const response = await fetch(`${relayOrigin}/api/browser-notifications/events?after=${encodeURIComponent(state.after)}`, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (response.ok) {
        const payload = await response.json()
        ;(payload.events || []).forEach(handleEvent)
        state.after = payload.serverTime || new Date().toISOString()
      }
    } catch (_) {
      // Push remains the closed-tab delivery path; polling retries quietly.
    } finally {
      state.timer = window.setTimeout(poll, document.visibilityState === 'visible' ? 5000 : 15000)
    }
  }

  fetch(`${relayOrigin}/api/browser-notifications/configuration`, { credentials: 'include', headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('not_authenticated')))
    .then((configuration) => { state.workspaceOrigin = configuration.workspaceOrigin || state.workspaceOrigin; poll() })
    .catch(() => undefined)
  window.addEventListener('pagehide', () => { if (state.timer) clearTimeout(state.timer) }, { once: true })
})()

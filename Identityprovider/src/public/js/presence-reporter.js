(function reportIdpPresence() {
  if (window.__seemplifyIdpPresenceReporter) return;
  window.__seemplifyIdpPresenceReporter = true;

  const storageKey = 'presence:idp:tab';
  const clientSessionId = sessionStorage.getItem(storageKey) || crypto.randomUUID();
  sessionStorage.setItem(storageKey, clientSessionId);
  let sessionId = null;
  let lastActionAt = 0;
  let stopped = false;

  const featureCode = () => `idp.${location.pathname.replace(/[^a-zA-Z0-9/_-]/g, '').replaceAll('/', '.').replace(/^\.+/, '') || 'home'}`.slice(0, 80);
  const send = (path, body) => fetch(`/api/presence${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const start = async () => {
    try {
      const response = await send('/sessions', { clientSessionId, visible: document.visibilityState === 'visible' });
      if (!response.ok) throw new Error('presence unavailable');
      const body = await response.json();
      if (!stopped) {
        sessionId = body.sessionId;
        void send(`/sessions/${sessionId}/activity`, { activityKind: 'navigation', featureCode: featureCode() }).catch(() => undefined);
      }
    } catch (_) {
      if (!stopped) setTimeout(start, 10000);
    }
  };
  setTimeout(start, 1000);
  setInterval(() => {
    if (sessionId && document.visibilityState === 'visible') void send(`/sessions/${sessionId}/heartbeat`, { visible: true }).catch(() => undefined);
  }, 120000);
  document.addEventListener('visibilitychange', () => {
    if (sessionId) void send(`/sessions/${sessionId}/heartbeat`, { visible: document.visibilityState === 'visible' }).catch(() => undefined);
  });
  document.addEventListener('click', () => {
    if (!sessionId || Date.now() - lastActionAt < 30000) return;
    lastActionAt = Date.now();
    void send(`/sessions/${sessionId}/activity`, { activityKind: 'action', featureCode: featureCode() }).catch(() => undefined);
  }, { passive: true });
  window.addEventListener('pagehide', () => {
    stopped = true;
    if (sessionId) void send(`/sessions/${sessionId}/end`, { reason: 'pagehide' }).catch(() => undefined);
  });
})();

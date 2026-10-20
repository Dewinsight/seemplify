type Send = (path: string, body: object) => Promise<Response>;

// Each instance belongs to one authenticated user and organisation.
export function createPresenceSession(send: Send, initialBody: () => object, now = Date.now) {
  let sessionId: string | null = null;
  let starting: Promise<void> | null = null;
  let retryAt = 0;
  let stopped = false;
  let generation = 0;
  const start = async () => {
    if (stopped || sessionId || now() < retryAt) return;
    if (starting) return starting;
    retryAt = now() + 10_000;
    starting = (async () => {
      try {
        const response = await send('/sessions', initialBody());
        if (!response.ok) return;
        const data = await response.json();
        const id = data.sessionId || data.session?._id;
        if (!stopped && typeof id === 'string' && id) { sessionId = id; generation++; }
      } catch { /* The next heartbeat retries with bounded frequency. */ }
    })();
    try { await starting; } finally { starting = null; }
  };
  const report = async (action: 'heartbeat' | 'activity', body: object) => {
    if (stopped) return;
    if (!sessionId) { await start(); return; }
    const id = sessionId;
    const reportedGeneration = generation;
    try {
      const response = await send(`/sessions/${id}/${action}`, body);
      if (response.status === 404 && !stopped && sessionId === id && generation === reportedGeneration) {
        sessionId = null;
        await start();
      }
    } catch { /* Reporting must not interrupt product actions. */ }
  };
  const stop = () => {
    stopped = true;
    const id = sessionId;
    sessionId = null;
    if (id) void send(`/sessions/${id}/end`, { reason: 'client_unmount' }).catch(() => undefined);
  };
  return { start, report, stop };
}

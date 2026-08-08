function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeReason(error, description) {
  const detail = `${error || ''} ${description || ''}`.toLowerCase()
  if (detail.includes('expired') || detail.includes('sessionnotfound')) {
    return {
      title: 'This sign-in request has expired',
      message: 'The link is no longer active. Start again to create a fresh, secure sign-in request.'
    }
  }
  if (detail.includes('temporarily') || detail.includes('unavailable') || detail.includes('server_error')) {
    return {
      title: 'Sign-in is temporarily unavailable',
      message: 'The identity service could not complete this request. You can retry safely or return to your workspace.'
    }
  }
  return {
    title: 'We could not complete sign-in',
    message: 'The request could not be verified. Start again from your workspace to continue securely.'
  }
}

export function renderOidcRecoveryPage({
  error,
  description,
  appId,
  appName,
  requestId,
  statusCode = 400
} = {}) {
  const reason = normalizeReason(error, description)
  const safeAppId = /^[a-z0-9-]+$/i.test(String(appId || '')) ? String(appId) : ''
  const retryUrl = safeAppId ? `/launch/${encodeURIComponent(safeAppId)}` : '/'
  const actionLabel = safeAppId ? `Try ${appName || 'the app'} again` : 'Return to workspace'

  return {
    statusCode,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(reason.title)} &middot; Seemplify</title>
  <link rel="stylesheet" href="/css/idp-theme.css?v=7">
  <script src="/js/theme.js?v=5"></script>
  <style>
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: var(--bg); color: var(--text); }
    .recovery { width: min(100%, 520px); border: 1px solid var(--border); border-radius: 10px; background: var(--panel-solid); overflow: hidden; }
    .recovery__bar { height: 4px; background: #7c3aed; }
    .recovery__body { padding: 32px; }
    .recovery__brand { width: 112px; height: auto; margin-bottom: 32px; }
    h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.25; letter-spacing: -.02em; }
    p { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.6; }
    .recovery__actions { display: flex; gap: 10px; margin-top: 28px; flex-wrap: wrap; }
    .button { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 0 16px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: transparent; text-decoration: none; font-size: 14px; font-weight: 700; }
    .button:hover { background: var(--hover-bg); }
    .button--primary { color: #fff; background: #6d28d9; border-color: #6d28d9; }
    .button--primary:hover { background: #5b21b6; }
    .recovery__foot { padding: 15px 32px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
    .recovery__foot code { color: inherit; font: inherit; }
    @media (max-width: 520px) { .recovery__body { padding: 24px; } .recovery__foot { padding: 14px 24px; } .recovery__actions { display: grid; } }
  </style>
</head>
<body>
  <main class="recovery">
    <div class="recovery__bar" aria-hidden="true"></div>
    <div class="recovery__body">
      <img class="recovery__brand" src="/images/seemplifylogo.png" alt="Seemplify">
      <h1>${escapeHtml(reason.title)}</h1>
      <p>${escapeHtml(reason.message)} No account or attendance data was changed.</p>
      <div class="recovery__actions">
        <a class="button button--primary" href="${escapeHtml(retryUrl)}">${escapeHtml(actionLabel)}</a>
        ${safeAppId ? '<a class="button" href="/">Return to workspace</a>' : '<a class="button" href="/login">Sign in</a>'}
      </div>
    </div>
    <div class="recovery__foot">If this keeps happening, share reference <code>${escapeHtml(requestId || 'not-available')}</code> with support.</div>
  </main>
</body>
</html>`
  }
}

export { normalizeReason }

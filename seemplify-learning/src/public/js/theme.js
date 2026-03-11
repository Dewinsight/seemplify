/**
 * Light-only theme manager.
 * Dark/system themes are intentionally disabled for now.
 */
(function () {
  const STORAGE_KEY = 'theme'
  const THEME_VALUE = 'light'
  const CSRF_COOKIE_KEY = 'seemplify_csrf'
  const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

  function setCookie(name, value, days) {
    let expires = ''
    if (days) {
      const date = new Date()
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000))
      expires = '; expires=' + date.toUTCString()
    }
    document.cookie = name + '=' + (value || '') + expires + '; path=/; SameSite=Lax'
  }

  function applyLightTheme() {
    const root = document.documentElement
    if (root.getAttribute('data-theme') !== THEME_VALUE) {
      root.setAttribute('data-theme', THEME_VALUE)
    }

    if (document.body) {
      document.body.classList.add('light')
      document.body.classList.remove('dark')
    }

    try {
      localStorage.setItem(STORAGE_KEY, THEME_VALUE)
    } catch {}
    setCookie(STORAGE_KEY, THEME_VALUE, 365)
  }

  function getCookie(name) {
    const target = String(name || '').trim()
    if (!target) return ''
    const prefix = target + '='
    const parts = String(document.cookie || '').split(';')
    for (let index = 0; index < parts.length; index += 1) {
      const entry = parts[index].trim()
      if (entry.indexOf(prefix) === 0) {
        return decodeURIComponent(entry.slice(prefix.length))
      }
    }
    return ''
  }

  function ensureCsrfField(form) {
    if (!form || String(form.method || 'get').trim().toUpperCase() === 'GET') {
      return
    }

    const token = getCookie(CSRF_COOKIE_KEY)
    if (!token) return

    let tokenInput = form.querySelector('input[name="_csrf"]')
    if (!tokenInput) {
      tokenInput = document.createElement('input')
      tokenInput.type = 'hidden'
      tokenInput.name = '_csrf'
      form.appendChild(tokenInput)
    }
    tokenInput.value = token
  }

  function applyCsrfToForms() {
    const forms = document.querySelectorAll('form')
    forms.forEach(ensureCsrfField)
  }

  function patchFetchWithCsrf() {
    if (typeof window.fetch !== 'function') return
    const nativeFetch = window.fetch.bind(window)
    window.fetch = function (input, init) {
      const sourceRequest = input instanceof Request ? input : null
      const method = String(init && init.method ? init.method : (sourceRequest ? sourceRequest.method : 'GET')).trim().toUpperCase()
      if (SAFE_METHODS.indexOf(method) >= 0) {
        return nativeFetch(input, init)
      }

      const requestUrl = sourceRequest ? sourceRequest.url : String(input || '')
      let sameOrigin = true
      try {
        sameOrigin = new URL(requestUrl || window.location.href, window.location.href).origin === window.location.origin
      } catch {}
      if (!sameOrigin) {
        return nativeFetch(input, init)
      }

      const token = getCookie(CSRF_COOKIE_KEY)
      if (!token) {
        return nativeFetch(input, init)
      }

      if (sourceRequest) {
        const headers = new Headers(sourceRequest.headers || {})
        if (!headers.has('x-csrf-token')) {
          headers.set('x-csrf-token', token)
        }
        return nativeFetch(new Request(sourceRequest, { headers }))
      }

      const nextInit = Object.assign({}, init || {})
      const headers = new Headers(nextInit.headers || {})
      if (!headers.has('x-csrf-token')) {
        headers.set('x-csrf-token', token)
      }
      nextInit.headers = headers
      return nativeFetch(input, nextInit)
    }
  }

  applyLightTheme()
  patchFetchWithCsrf()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      applyLightTheme()
      applyCsrfToForms()
    })
  } else {
    applyLightTheme()
    applyCsrfToForms()
  }

  document.addEventListener('submit', function (event) {
    const form = event && event.target && event.target.tagName === 'FORM' ? event.target : null
    if (form) {
      ensureCsrfField(form)
    }
  }, true)

  // Keep API available for any legacy handlers still in templates.
  window.ThemeManager = {
    setTheme: function () {
      applyLightTheme()
    },
    toggleDropdown: function () {},
    getTheme: function () {
      return THEME_VALUE
    }
  }
})()

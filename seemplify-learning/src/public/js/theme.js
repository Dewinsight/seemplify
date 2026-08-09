/**
 * Shared browser theme contract for the Identity Provider.
 * The non-sensitive preference is shared by first-party Seemplify subdomains.
 */
(function () {
  const STORAGE_KEY = 'seemplify_theme'
  const LEGACY_STORAGE_KEY = 'seemplify-theme'
  const COOKIE_KEY = 'seemplify_theme'
  const VALID_THEMES = ['system', 'light', 'dark']
  const THEME_MENU_SELECTOR = '.theme-menu, .admin-theme-menu'
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

  function isTheme(value) {
    return VALID_THEMES.indexOf(value) >= 0
  }

  function getCookie(name) {
    try {
      const prefix = name + '='
      const entries = String(document.cookie || '').split(';')
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index].trim()
        if (entry.indexOf(prefix) === 0) return decodeURIComponent(entry.slice(prefix.length))
      }
    } catch (_) {}
    return null
  }

  function setSharedCookie(value) {
    try {
      const hostname = location.hostname
      const sharedDomain =
        hostname === 'seemplifyai.com' || hostname.endsWith('.seemplifyai.com')
      document.cookie =
        COOKIE_KEY + '=' + encodeURIComponent(value) +
        '; Max-Age=31536000; Path=/; SameSite=Lax' +
        (sharedDomain ? '; Domain=.seemplifyai.com' : '') +
        (location.protocol === 'https:' ? '; Secure' : '')
    } catch (_) {}
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key)
    } catch (_) {
      return null
    }
  }

  function writeStorage(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch (_) {}
  }

  function getTheme() {
    const cookieTheme = getCookie(COOKIE_KEY)
    if (isTheme(cookieTheme)) {
      writeStorage(cookieTheme)
      return cookieTheme
    }

    const candidates = [
      readStorage(STORAGE_KEY),
      readStorage(LEGACY_STORAGE_KEY),
      getCookie('theme'),
      readStorage('theme'),
      readStorage('themeMode')
    ]
    let preference = 'system'
    for (let index = 0; index < candidates.length; index += 1) {
      if (isTheme(candidates[index])) {
        preference = candidates[index]
        break
      }
    }

    writeStorage(preference)
    setSharedCookie(preference)
    return preference
  }

  function resolveTheme(preference) {
    if (preference !== 'system') return preference
    return mediaQuery.matches ? 'dark' : 'light'
  }

  function applyTheme(preference) {
    const safePreference = isTheme(preference) ? preference : 'system'
    const resolved = resolveTheme(safePreference)
    const root = document.documentElement

    root.classList.remove('light', 'dark')
    root.classList.add(resolved)
    root.setAttribute('data-theme-preference', safePreference)
    root.setAttribute('data-theme', resolved)
    root.style.colorScheme = resolved

    if (document.body) {
      document.body.classList.remove('light', 'dark')
      document.body.classList.add(resolved)
    }

    window.dispatchEvent(new CustomEvent('seemplify-theme-change', {
      detail: { preference: safePreference, resolved: resolved }
    }))
    window.dispatchEvent(new CustomEvent('theme-change', { detail: resolved }))
    return resolved
  }

  function updateToggleUI(preference) {
    const resolved = resolveTheme(preference)
    document.querySelectorAll('.theme-option').forEach(function (item) {
      const selected = item.dataset.value === preference
      item.classList.toggle('active', selected)
      item.setAttribute('role', 'menuitemradio')
      item.setAttribute('aria-checked', selected ? 'true' : 'false')
    })

    document.querySelectorAll('.theme-toggle, .admin-theme-toggle').forEach(function (toggle) {
      toggle.setAttribute('aria-label', 'Appearance: ' + preference + '. Choose a theme')
      toggle.setAttribute('aria-haspopup', 'menu')
      const menu = toggle.closest('.theme-dropdown') && toggle.closest('.theme-dropdown').querySelector(THEME_MENU_SELECTOR)
      toggle.setAttribute('aria-expanded', menu && menu.classList.contains('show') ? 'true' : 'false')
    })

    document.querySelectorAll('.theme-toggle-icon-light').forEach(function (icon) {
      icon.style.display = resolved === 'dark' ? 'block' : 'none'
    })
    document.querySelectorAll('.theme-toggle-icon-dark').forEach(function (icon) {
      icon.style.display = resolved === 'light' ? 'block' : 'none'
    })
  }

  function syncSharedPreference() {
    const preference = getTheme()
    applyTheme(preference)
    updateToggleUI(preference)
  }

  // Apply before the document paints; templates load this script in <head>.
  syncSharedPreference()

  function initUI() {
    syncSharedPreference()
    document.querySelectorAll(THEME_MENU_SELECTOR).forEach(function (menu) {
      menu.setAttribute('role', 'menu')
      menu.setAttribute('aria-label', 'Appearance')
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI)
  } else {
    initUI()
  }

  window.ThemeManager = {
    setTheme: function (preference) {
      if (!isTheme(preference)) return
      const activeItem = document.activeElement && document.activeElement.matches && document.activeElement.matches('.theme-option')
        ? document.activeElement
        : null
      const activeDropdown = activeItem && activeItem.closest('.theme-dropdown')
      const activeTrigger = activeDropdown && activeDropdown.querySelector('.theme-toggle, .admin-theme-toggle')
      writeStorage(preference)
      setSharedCookie(preference)
      applyTheme(preference)
      updateToggleUI(preference)
      document.querySelectorAll('.theme-menu.show, .admin-theme-menu.show').forEach(function (menu) {
        menu.classList.remove('show')
      })
      updateToggleUI(preference)
      if (activeTrigger) activeTrigger.focus()
    },
    toggleDropdown: function (event) {
      if (event) {
        event.stopPropagation()
        event.preventDefault()
      }
      const trigger = event && event.currentTarget
      const dropdown = trigger && trigger.closest('.theme-dropdown')
      const menu = dropdown && dropdown.querySelector(THEME_MENU_SELECTOR)
      if (!menu) return
      const willOpen = !menu.classList.contains('show')
      document.querySelectorAll('.theme-menu.show, .admin-theme-menu.show').forEach(function (openMenu) {
        openMenu.classList.remove('show')
      })
      menu.classList.toggle('show', willOpen)
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
      if (willOpen) {
        const selected = menu.querySelector('[aria-checked="true"]')
        if (selected) selected.focus()
      }
    },
    getTheme: getTheme
  }

  document.addEventListener('click', function (event) {
    const target = event.target instanceof Element ? event.target : null
    if (!target || !target.closest('.theme-dropdown')) {
      document.querySelectorAll('.theme-menu.show, .admin-theme-menu.show').forEach(function (menu) {
        menu.classList.remove('show')
      })
      updateToggleUI(getTheme())
    }
  })

  document.addEventListener('keydown', function (event) {
    const target = event.target instanceof Element ? event.target : null
    const activeMenu = target && target.closest('.theme-menu.show, .admin-theme-menu.show')
    if (activeMenu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) >= 0) {
      const items = Array.from(activeMenu.querySelectorAll('[role="menuitemradio"]'))
      const currentIndex = items.indexOf(document.activeElement)
      let nextIndex = currentIndex
      if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
      if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
      if (event.key === 'Home') nextIndex = 0
      if (event.key === 'End') nextIndex = items.length - 1
      if (items[nextIndex]) items[nextIndex].focus()
      event.preventDefault()
      return
    }
    if (event.key !== 'Escape') return
    const openMenu = document.querySelector('.theme-menu.show, .admin-theme-menu.show')
    if (!openMenu) return
    openMenu.classList.remove('show')
    const trigger = openMenu.closest('.theme-dropdown') && openMenu.closest('.theme-dropdown').querySelector('.theme-toggle, .admin-theme-toggle')
    if (trigger) trigger.focus()
    updateToggleUI(getTheme())
  })

  window.addEventListener('storage', function (event) {
    if ([STORAGE_KEY, LEGACY_STORAGE_KEY, 'theme', 'themeMode'].indexOf(event.key) >= 0) {
      syncSharedPreference()
    }
  })
  window.addEventListener('focus', syncSharedPreference)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') syncSharedPreference()
  })
  mediaQuery.addEventListener('change', function () {
    if (getTheme() === 'system') {
      applyTheme('system')
      updateToggleUI('system')
    }
  })
})()

;(function () {
  const CSRF_COOKIE_KEY = 'seemplify_csrf'
  const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

  function getCookie(name) {
    const prefix = name + '='
    const entries = String(document.cookie || '').split(';')
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index].trim()
      if (entry.indexOf(prefix) === 0) return decodeURIComponent(entry.slice(prefix.length))
    }
    return ''
  }

  function ensureCsrfField(form) {
    if (!form || String(form.method || 'get').trim().toUpperCase() === 'GET') return
    const token = getCookie(CSRF_COOKIE_KEY)
    if (!token) return
    let input = form.querySelector('input[name="_csrf"]')
    if (!input) {
      input = document.createElement('input')
      input.type = 'hidden'
      input.name = '_csrf'
      form.appendChild(input)
    }
    input.value = token
  }

  function patchFetchWithCsrf() {
    if (typeof window.fetch !== 'function') return
    const nativeFetch = window.fetch.bind(window)
    window.fetch = function (input, init) {
      const source = input instanceof Request ? input : null
      const method = String(init && init.method ? init.method : (source ? source.method : 'GET')).trim().toUpperCase()
      if (SAFE_METHODS.indexOf(method) >= 0) return nativeFetch(input, init)

      let sameOrigin = true
      try {
        sameOrigin = new URL(source ? source.url : String(input || ''), window.location.href).origin === window.location.origin
      } catch (_) {}
      const token = sameOrigin ? getCookie(CSRF_COOKIE_KEY) : ''
      if (!token) return nativeFetch(input, init)

      if (source) {
        const headers = new Headers(source.headers || {})
        if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', token)
        return nativeFetch(new Request(source, { headers: headers }))
      }
      const nextInit = Object.assign({}, init || {})
      const headers = new Headers(nextInit.headers || {})
      if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', token)
      nextInit.headers = headers
      return nativeFetch(input, nextInit)
    }
  }

  patchFetchWithCsrf()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      document.querySelectorAll('form').forEach(ensureCsrfField)
    })
  } else {
    document.querySelectorAll('form').forEach(ensureCsrfField)
  }
  document.addEventListener('submit', function (event) {
    const form = event.target && event.target.tagName === 'FORM' ? event.target : null
    if (form) ensureCsrfField(form)
  }, true)
})()

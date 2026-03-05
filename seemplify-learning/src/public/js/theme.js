/**
 * Light-only theme manager.
 * Dark/system themes are intentionally disabled for now.
 */
(function () {
  const STORAGE_KEY = 'theme'
  const THEME_VALUE = 'light'

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

  applyLightTheme()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLightTheme)
  } else {
    applyLightTheme()
  }

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

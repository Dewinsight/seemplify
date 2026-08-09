import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const modulePaths = [
  'marketing-site/lib/theme-sync.ts',
  'recruiter/frontend/lib/theme-sync.ts',
  'digilog-recruiter/frontend/lib/theme-sync.ts',
  'leave-management/frontend/lib/theme-sync.ts',
  'payroll/frontend/lib/theme-sync.ts',
  'performance/frontend/lib/theme-sync.ts',
  'time-attendance/frontend/lib/theme-sync.ts',
  'experience-management/frontend/src/lib/theme.ts',
]

const bootstrapFrom = (source) => {
  const match = source.match(/export const themeInitScript = `([\s\S]*?)`;/)
  assert.ok(match, 'theme module must export an inline bootstrap')
  return match[1]
}

const bootstraps = modulePaths.map((relative) => bootstrapFrom(read(relative)))
for (const bootstrap of bootstraps.slice(1)) {
  assert.equal(bootstrap, bootstraps[0], 'all TypeScript apps must use the same pre-paint bootstrap')
}

function runBootstrap({
  hostname = 'localhost',
  protocol = 'http:',
  cookie = '',
  storage = {},
  systemDark = false,
  cookiesBlocked = false,
  storageBlocked = false,
} = {}) {
  const attributes = new Map()
  const classes = new Set()
  const writes = []
  const cookieJar = new Map()
  for (const entry of cookie.split(';')) {
    const [key, ...rest] = entry.trim().split('=')
    if (key) cookieJar.set(key, rest.join('='))
  }
  const store = new Map(Object.entries(storage))

  const document = {
    documentElement: {
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
      },
      setAttribute: (name, value) => attributes.set(name, value),
      style: {},
    },
  }
  Object.defineProperty(document, 'cookie', {
    get() {
      return Array.from(cookieJar, ([key, value]) => `${key}=${value}`).join('; ')
    },
    set(value) {
      if (cookiesBlocked) throw new Error('cookies blocked')
      writes.push(value)
      const [pair] = value.split(';')
      const [key, ...rest] = pair.split('=')
      cookieJar.set(key, rest.join('='))
    },
  })

  const localStorage = {
    getItem(key) {
      if (storageBlocked) throw new Error('storage blocked')
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      if (storageBlocked) throw new Error('storage blocked')
      store.set(key, String(value))
    },
  }

  vm.runInNewContext(bootstraps[0], {
    document,
    localStorage,
    location: { hostname, protocol },
    matchMedia: () => ({ matches: systemDark }),
    decodeURIComponent,
    encodeURIComponent,
  })

  return { attributes, classes, cookieJar, store, writes, root: document.documentElement }
}

{
  const state = runBootstrap({ systemDark: true })
  assert.equal(state.attributes.get('data-theme-preference'), 'system')
  assert.equal(state.attributes.get('data-theme'), 'dark')
  assert.ok(state.classes.has('dark'))
  assert.equal(state.root.style.colorScheme, 'dark')
  assert.equal(state.store.get('seemplify_theme'), 'system')
  assert.match(state.writes[0], /^seemplify_theme=system;/)
  assert.doesNotMatch(state.writes[0], /Domain=/)
}

{
  const state = runBootstrap({ cookie: 'seemplify_theme=light', systemDark: true })
  assert.equal(state.attributes.get('data-theme-preference'), 'light')
  assert.equal(state.attributes.get('data-theme'), 'light')
  assert.equal(state.store.get('seemplify_theme'), 'light')
  assert.equal(state.writes.length, 0)
}

{
  const state = runBootstrap({
    hostname: 'recruiter.seemplifyai.com',
    protocol: 'https:',
    cookie: 'seemplify_theme=invalid',
    storage: { seemplify_theme: 'dark' },
  })
  assert.equal(state.attributes.get('data-theme'), 'dark')
  assert.match(state.writes[0], /Domain=\.seemplifyai\.com/)
  assert.match(state.writes[0], /; Secure/)
  assert.equal(state.cookieJar.get('seemplify_theme'), 'dark')
}

{
  const state = runBootstrap({
    hostname: 'evilseemplifyai.com',
    protocol: 'https:',
    storage: { 'seemplify-theme': 'light' },
  })
  assert.equal(state.attributes.get('data-theme-preference'), 'light')
  assert.doesNotMatch(state.writes[0], /Domain=/)
}

{
  const state = runBootstrap({ cookiesBlocked: true, storage: { seemplify_theme: 'dark' } })
  assert.equal(state.attributes.get('data-theme'), 'dark')
  assert.equal(state.store.get('seemplify_theme'), 'dark')
}

{
  const state = runBootstrap({ storageBlocked: true, cookie: 'seemplify_theme=light' })
  assert.equal(state.attributes.get('data-theme'), 'light')
}

const layoutPaths = [
  'marketing-site/app/layout.tsx',
  'recruiter/frontend/app/layout.tsx',
  'digilog-recruiter/frontend/app/layout.tsx',
  'leave-management/frontend/app/layout.tsx',
  'payroll/frontend/app/layout.tsx',
  'performance/frontend/app/layout.tsx',
  'time-attendance/frontend/app/layout.tsx',
]
for (const relative of layoutPaths) {
  const source = read(relative)
  assert.match(source, /themeInitScript/, `${relative} must install the pre-paint bootstrap`)
  assert.match(source, /suppressHydrationWarning/, `${relative} must tolerate the pre-hydration root attributes`)
}

const controls = [
  'marketing-site/components/MarketingThemeToggle.tsx',
  'recruiter/frontend/components/ui/theme-toggle.tsx',
  'leave-management/frontend/components/ThemeToggle.tsx',
  'payroll/frontend/components/ThemePreferenceMenu.tsx',
  'performance/frontend/components/ThemePreferenceMenu.tsx',
  'time-attendance/frontend/components/ThemePreferenceMenu.tsx',
  'experience-management/frontend/src/components/ThemePreferenceMenu.tsx',
  'Identityprovider/src/views/partials/nav.ejs',
  'Identityprovider/src/views/partials/admin-nav.ejs',
  'seemplify-learning/src/views/partials/nav.ejs',
]
for (const relative of controls) {
  const source = read(relative)
  for (const preference of ['system', 'light', 'dark']) {
    assert.match(source.toLowerCase(), new RegExp(`['"]?${preference}['"]?`), `${relative} must expose ${preference}`)
  }
}

for (const relative of ['Identityprovider/src/public/js/theme.js', 'seemplify-learning/src/public/js/theme.js']) {
  const source = read(relative)
  assert.match(source, /data-theme-preference/)
  assert.match(source, /hostname\.endsWith\('\.seemplifyai\.com'\)/)
  assert.match(source, /SameSite=Lax/)
  assert.match(source, /getTheme\(\) === 'system'/)
  assert.match(source, /seemplify-theme-change/)
  assert.match(source, /theme-change/)
  if (relative.startsWith('Identityprovider/')) {
    assert.match(source, /\.admin-theme-menu/, 'IDP manager must support the admin shell menu')
  }
}

for (const relative of [
  'Identityprovider/src/public/css/idp-theme.css',
  'Identityprovider/src/public/css/admin.css',
  'seemplify-learning/src/public/css/idp-theme.css',
]) {
  const source = read(relative)
  assert.match(source, /focus-visible/, `${relative} must visibly indicate keyboard focus`)
  assert.match(source, /min-height:\s*44px|height:\s*44px/, `${relative} must provide a 44px theme target`)
}

const marketingThemeCss = read('marketing-site/app/globals.css')
assert.match(marketingThemeCss, /\.marketing-theme-menu__option:focus-visible\s*\{[^}]*outline:/s)
assert.doesNotMatch(
  marketingThemeCss,
  /\.marketing-theme-menu__option\[aria-checked='true'\]\s*\{[^}]*outline:/s,
  'selected and keyboard-focused states must remain visually distinct',
)

const experienceHtml = read('experience-management/frontend/index.html')
assert.ok(
  experienceHtml.indexOf('seemplify_theme') < experienceHtml.indexOf('/src/main.tsx'),
  'Experience Management must bootstrap before its application module',
)
assert.match(read('experience-management/frontend/src/styles.css'), /:root\[data-theme="dark"\]/)

console.log('Shared browser theme contract: all focused checks passed.')

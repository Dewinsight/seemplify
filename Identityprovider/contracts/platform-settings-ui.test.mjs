import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

test('admin navigation exposes one platform settings entry for the three settings areas', () => {
  const navigation = read('../src/views/partials/admin-nav.ejs')

  assert.equal((navigation.match(/Platform Settings/g) || []).length, 1)
  assert.doesNotMatch(navigation, />\s*Shared AI Gateway\s*</)
  assert.doesNotMatch(navigation, />\s*Nylas Integration\s*</)
  assert.doesNotMatch(navigation, />\s*Media &amp; Speech\s*</)
  assert.match(navigation, /\['shared-ai', 'nylas-integration', 'media-ai-integration'\]/)
})
test('platform settings tabs link all three existing settings screens', () => {
  const tabs = read('../src/views/partials/admin-platform-settings-tabs.ejs')

  assert.match(tabs, /href="\/admin\/shared-ai"/)
  assert.match(tabs, /href="\/admin\/integrations\/nylas"/)
  assert.match(tabs, /href="\/admin\/integrations\/media-ai"/)
  assert.match(tabs, /aria-current="page"/)
})

test('each settings screen uses the shared tab navigation with its own active tab', () => {
  const expectedTabs = new Map([
    ['../src/views/admin/shared-ai.ejs', 'shared-ai'],
    ['../src/views/admin/nylas-integration.ejs', 'nylas'],
    ['../src/views/admin/media-ai-integration.ejs', 'media-ai']
  ])

  for (const [path, tab] of expectedTabs) {
    const view = read(path)
    assert.match(view, /<h1>Platform Settings<\/h1>/)
    assert.ok(view.includes(`activeSettingsTab: '${tab}'`))
    assert.match(view, /href="\/css\/admin\.css\?v=4"/)
  }
})

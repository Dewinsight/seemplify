import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readView = (name) => readFile(new URL(`../src/views/${name}`, import.meta.url), 'utf8')

test('workspace and player dark themes use Seemplify semantic surfaces', async () => {
  const [workspace, player] = await Promise.all([
    readView('simple-lms.ejs'),
    readView('simple-lms-player.ejs')
  ])

  assert.match(workspace, /\[data-theme="dark"\][\s\S]*--lms-surface:\s*var\(--seem-surface/)
  assert.match(workspace, /\[data-theme="dark"\][\s\S]*--panel-solid:\s*var\(--seem-surface/)
  assert.doesNotMatch(workspace, /\[data-theme="dark"\]\s*\{[^}]*--lms-surface:\s*#fff/is)

  assert.match(player, /\[data-theme="dark"\][\s\S]*--player-surface:\s*var\(--seem-surface/)
  assert.match(player, /\[data-theme="dark"\][\s\S]*--player-surface-strong:\s*var\(--seem-surface-soft/)
  assert.doesNotMatch(player, /\[data-theme="dark"\]\s*\{[^}]*--player-surface:\s*#fff/is)
})

test('learner overview keeps navigation compact and puts course work first', async () => {
  const workspace = await readView('simple-lms.ejs')

  assert.match(workspace, /<header class="workspace-header">/)
  assert.match(workspace, /<nav class="tabs" aria-label="Learning workspace">/)
  assert.match(workspace, /<h2>Continue learning<\/h2>/)
  assert.match(workspace, /<h2>Available courses<\/h2>/)
  assert.match(workspace, /class="overview-list"/)
  assert.doesNotMatch(workspace, /<section class="hero">/)
  assert.doesNotMatch(workspace, /class="learning-summary"/)
  assert.doesNotMatch(workspace, /class="chips"/)
  assert.doesNotMatch(workspace, /Everything you can learn, in one place/)
})

test('signed-in utility pages use shared canvas and surface tokens', async () => {
  const pages = await Promise.all([
    'simple-lms-cart.ejs',
    'simple-lms-settings.ejs',
    'simple-lms-payment-checkout.ejs',
    'simple-lms-workspace.ejs'
  ].map(readView))

  pages.forEach((page) => {
    assert.match(page, /background:\s*var\(--seem-canvas/)
    assert.match(page, /background:\s*var\(--seem-surface/)
    assert.match(page, /color:\s*var\(--seem-text/)
  })
})

test('course studio defines a complete dark token map and component overrides', async () => {
  const studio = await readView('course-studio.ejs')

  assert.match(studio, /\[data-theme="dark"\]\s*\{[\s\S]*--studio-surface:\s*var\(--seem-surface/)
  assert.match(studio, /\[data-theme="dark"\] \.rail-pill,[\s\S]*\[data-theme="dark"\] \.hero-metric/)
  assert.match(studio, /\[data-theme="dark"\] \.wizard-step\.active/)
})

test('legacy administration surfaces are normalized by the final brand layer', async () => {
  const brand = await readFile(new URL('../src/public/css/seemplify-brand.css', import.meta.url), 'utf8')

  assert.match(brand, /\[data-theme="dark"\] body\.admin-page \.course-record-panel/)
  assert.match(brand, /\[data-theme="dark"\] body\.admin-page \.audit-entry/)
  assert.match(brand, /\[data-theme="dark"\] body\.admin-page \[style\*="background: #fff"\]/)
  assert.match(brand, /\[data-theme="dark"\] body\.admin-page th,[\s\S]*background: var\(--seem-surface-soft\) !important/)
})

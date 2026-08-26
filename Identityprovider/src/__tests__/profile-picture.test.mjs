import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { hasSupportedProfilePictureSignature } from '../routes/profile.js'

test('profile picture upload validates the actual image signature', () => {
  assert.equal(hasSupportedProfilePictureSignature({
    mimetype: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])
  }), true)
  assert.equal(hasSupportedProfilePictureSignature({
    mimetype: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  }), true)
  assert.equal(hasSupportedProfilePictureSignature({
    mimetype: 'image/jpeg',
    buffer: Buffer.from('not-an-image')
  }), false)
})

test('Identity publishes the canonical picture through profile claims and member APIs', async () => {
  const [indexSource, memberSource, reconciliationSource] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../routes/members.js', import.meta.url), 'utf8'),
    readFile(new URL('../routes/internalMemberships.js', import.meta.url), 'utf8')
  ])
  assert.match(indexSource, /picture: acc\.profile\?\.picture/)
  assert.match(indexSource, /'preferred_username', 'picture'/)
  assert.match(memberSource, /picture: m\.account\.profile\?\.picture/)
  assert.match(reconciliationSource, /picture: account\.profile\?\.picture/)
})

test('profile picture page provides client-side crop and an accessible Identity-owned flow', async () => {
  const [view, script] = await Promise.all([
    readFile(new URL('../views/profile-avatar.ejs', import.meta.url), 'utf8'),
    readFile(new URL('../public/js/profile-avatar.js', import.meta.url), 'utf8')
  ])
  assert.match(view, /Managed in Identity/)
  assert.match(view, /role="dialog" aria-modal="true"/)
  assert.match(view, /Apply and upload/)
  assert.match(script, /canvas\.toBlob/)
  assert.match(script, /\/api\/profile\/picture/)
})

import assert from 'node:assert/strict'
import test from 'node:test'

await import('../src/public/js/invitation-recipient-parser.js')

const {
  extractEmailAddresses,
  isValidEmail,
  normalizePastedText
} = globalThis.InvitationRecipientParser

test('extracts the supplied unstructured recipient list in pasted order', () => {
  const result = extractEmailAddresses(`
    ibukun.abraham\\@flutterwavego.com svbdsfbvdfb&#x20;
    emmanuel.samuel\\@flutterwavego.com vdbdfbdfb&#x20;
    opeyemi.salu\\@flutterwavego.com dsbdfbfgb&#x20;
    gloria\\@flutterwavego.com bfrbdb&#x20;
    blessing.mbuba\\@flutterwave.com sdfbdfbdfbd
  `)

  assert.deepEqual(result.emails, [
    'ibukun.abraham@flutterwavego.com',
    'emmanuel.samuel@flutterwavego.com',
    'opeyemi.salu@flutterwavego.com',
    'gloria@flutterwavego.com',
    'blessing.mbuba@flutterwave.com'
  ])
  assert.equal(result.duplicateCount, 0)
  assert.equal(result.truncatedCount, 0)
})

test('supports mixed prose and delimiters while removing duplicates case-insensitively', () => {
  const result = extractEmailAddresses(
    'Please invite Amina <AMINA@example.com>; lee@example.org, then amina@example.com and mailto:dev+alerts@example.co.uk.'
  )

  assert.deepEqual(result.emails, [
    'amina@example.com',
    'lee@example.org',
    'dev+alerts@example.co.uk'
  ])
  assert.equal(result.duplicateCount, 1)
})

test('normalizes full-width and invisible copy artifacts', () => {
  const pasted = 'first＠example．com second@exa\u200Bmple.com third&commat;example&#46;org'

  assert.equal(
    normalizePastedText(pasted),
    'first@example.com second@example.com third@example.org'
  )
  assert.deepEqual(extractEmailAddresses(pasted).emails, [
    'first@example.com',
    'second@example.com',
    'third@example.org'
  ])
})

test('rejects malformed addresses and reports addresses beyond the batch limit', () => {
  assert.equal(isValidEmail('first..last@example.com'), false)
  assert.equal(isValidEmail('person@-example.com'), false)
  assert.equal(isValidEmail('person@example'), false)

  const result = extractEmailAddresses(
    'one@example.com two@example.com three@example.com four@example.com',
    { limit: 2 }
  )

  assert.deepEqual(result.emails, ['one@example.com', 'two@example.com'])
  assert.equal(result.truncatedCount, 2)
})

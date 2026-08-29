import assert from 'node:assert/strict'
import test from 'node:test'

import { Account } from '../models/Account.js'

test('Account keeps one complete Identity-owned profile schema', () => {
  const requiredPaths = [
    'profile.picture',
    'profile.pictureStorageProvider',
    'profile.personalInfo.dateOfBirth',
    'profile.personalInfo.emergencyContacts.isPrimary',
    'profile.taxInfo.taxId',
    'profile.taxInfo.multipleJobs',
    'profile.completionReminders.lastCompletedAt'
  ]

  for (const path of requiredPaths) {
    assert.ok(Account.schema.path(path), `Missing Account schema path: ${path}`)
  }

  const account = new Account({
    sub: 'profile-schema-test',
    email: 'profile-schema@example.com',
    profile: {
      picture: 'https://images.example.com/profile.webp',
      pictureStorageProvider: 'cloudinary',
      personalInfo: {
        emergencyContacts: [{
          name: 'Jane Example',
          relationship: 'Friend',
          phone: '+44 7700 900456',
          isPrimary: true
        }]
      }
    }
  })

  const stored = account.toObject()
  assert.equal(stored.profile.picture, 'https://images.example.com/profile.webp')
  assert.equal(stored.profile.pictureStorageProvider, 'cloudinary')
  assert.equal(stored.profile.personalInfo.emergencyContacts[0].isPrimary, true)
})

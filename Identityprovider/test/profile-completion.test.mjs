import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPayrollProfileSyncData, getProfileCompletion } from '../src/utils/profileCompletion.js'

const completeAccount = {
  profile: {
    personalInfo: {
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      mailingAddress: {
        street: '1 Example Street',
        city: 'London',
        country: 'UK'
      },
      phoneNumbers: {
        mobile: '+44 7000 000000'
      },
      emergencyContacts: [
        {
          name: 'Emergency Contact',
          phone: '+44 7000 000001',
          isPrimary: true
        }
      ]
    },
    banking: {
      country: 'UK',
      accounts: [
        {
          bankName: 'Example Bank',
          accountNumber: '12345678',
          sortCode: '001122',
          isPrimary: true,
          isActive: true
        }
      ]
    },
    dependentsDeclaration: {
      status: 'none'
    }
  }
}

test('IDP profile completion ignores legacy onboarding document assignments', () => {
  const completion = getProfileCompletion(completeAccount, {
    onboardingAssignments: [
      {
        _id: 'legacy-assignment',
        workflowType: 'onboarding',
        status: 'pending'
      }
    ]
  })

  assert.deepEqual(completion.steps.map(step => step.key), ['personal'])
  assert.equal(completion.complete, true)
  assert.equal(completion.totalSteps, 1)
  assert.equal(completion.onboarding.isAssigned, false)
  assert.equal(completion.onboarding.requiresAction, false)
  assert.equal(completion.summary.onboarding, null)
})

test('legacy payroll-owned fields are absent from Identity completion and sync contracts', () => {
  const account = structuredClone(completeAccount)
  account.profile.dependentsDeclaration = {
    status: 'provided',
    count: 2,
    confirmedAt: new Date('2026-08-19T00:00:00.000Z')
  }

  const completion = getProfileCompletion(account)
  const payrollSync = buildPayrollProfileSyncData(account)

  assert.equal(completion.complete, true)
  assert.equal(completion.steps.some(step => step.key === 'dependents'), false)
  assert.equal(Object.hasOwn(completion, 'dependentsCount'), false)
  assert.equal(Object.hasOwn(payrollSync, 'dependents'), false)
  assert.equal(Object.hasOwn(payrollSync, 'dependentsDeclaration'), false)
  assert.equal(Object.hasOwn(payrollSync, 'banking'), false)
})

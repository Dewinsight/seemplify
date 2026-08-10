import assert from 'node:assert/strict'
import test from 'node:test'

import { getAllComingSoonCards, getComingSoonCards } from '../src/config/hubApps.js'

test('HMO Plans is available as a plan-controlled coming soon card', () => {
  const card = getAllComingSoonCards().find(item => item.cardId === 'hmo-plans')

  assert.deepEqual(card, {
    cardId: 'hmo-plans',
    name: 'HMO Plans',
    description: 'Employee health plans, family coverage, enrolment, and payroll contributions',
    icon: 'users',
    color: '#94a3b8',
    order: 4
  })
  assert.deepEqual(getComingSoonCards(['hmo-plans']), [card])
})

test('HMO Plans stays hidden when a plan does not enable it', () => {
  assert.deepEqual(getComingSoonCards([]), [])
  assert.equal(
    getComingSoonCards(['performance-management']).some(card => card.cardId === 'hmo-plans'),
    false
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { listCountries, listStates, searchCities } from './src/services/geographyService.js'

test('worldwide geography directory exposes stable country and region codes', () => {
  const countries = listCountries()
  assert.ok(countries.length >= 240)
  assert.deepEqual(countries.find((country) => country.code === 'NG'), { code: 'NG', name: 'Nigeria' })
  assert.ok(listStates('NG').some((state) => state.name === 'Lagos'))
  assert.ok(listStates('US').some((state) => state.code === 'CA' && state.name === 'California'))
})

test('city search is scoped and bounded for responsive autocomplete', () => {
  const cities = searchCities({ countryCode: 'NG', stateCode: 'LA', query: 'lag' })
  assert.ok(cities.includes('Lagos'))
  assert.ok(cities.length <= 50)
  assert.deepEqual(searchCities({ countryCode: 'NG', query: 'l' }), [])
})

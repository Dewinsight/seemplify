import { Cities, Countries, States } from 'countries-states-cities-service'

const normalizeCode = (value) => String(value || '').trim().toUpperCase()

export function listCountries() {
  return Countries.getCountries()
    .map((country) => ({ code: country.iso2, name: country.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function listStates(countryCode) {
  const code = normalizeCode(countryCode)
  if (!/^[A-Z]{2}$/.test(code)) return []
  return States.getStates({ filters: { country_code: code } })
    .map((state) => ({ code: state.state_code, name: state.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function searchCities({ countryCode, stateCode, query, limit = 50 }) {
  const country = normalizeCode(countryCode)
  const state = normalizeCode(stateCode)
  const term = String(query || '').trim().toLocaleLowerCase()
  if (!/^[A-Z]{2}$/.test(country) || term.length < 2) return []

  const cities = Cities.getCities({
    filters: {
      country_code: country,
      ...(state ? { state_code: state } : {})
    }
  })
  const uniqueNames = new Set()
  const startsWith = []
  const contains = []

  for (const city of cities || []) {
    const name = String(city.name || '').trim()
    const normalizedName = name.toLocaleLowerCase()
    if (!name || uniqueNames.has(normalizedName) || !normalizedName.includes(term)) continue
    uniqueNames.add(normalizedName)
    ;(normalizedName.startsWith(term) ? startsWith : contains).push(name)
  }

  return [...startsWith.sort(), ...contains.sort()].slice(0, Math.max(1, Math.min(Number(limit) || 50, 100)))
}

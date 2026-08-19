import express from 'express'
import { requireAuth } from '../middleware/permissions.js'
import { listCountries, listStates, searchCities } from '../services/geographyService.js'

const router = express.Router()

router.use(requireAuth)

router.get('/countries', (_req, res) => {
  res.json({ countries: listCountries() })
})

router.get('/states', (req, res) => {
  res.json({ states: listStates(req.query.country) })
})

router.get('/cities', (req, res) => {
  res.json({
    cities: searchCities({
      countryCode: req.query.country,
      stateCode: req.query.state,
      query: req.query.q
    })
  })
})

export default router

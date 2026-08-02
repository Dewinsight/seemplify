const express = require('express');
const router = express.Router();
const {
  getCurrencies,
  getCurrency,
  createCurrency,
  updateCurrency,
  deleteCurrency,
  getCurrencyUsage,
  setDefaultCurrency
} = require('../controllers/currencyController');

// Middleware
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');

// All routes require authentication and organization context
router.use(authMiddleware);
router.use(requireOrganization);

// @route   GET api/currencies
// @desc    Get all currencies available for organization
// @access  Private
router.get('/', getCurrencies);

// @route   GET api/currencies/:code/usage
// @desc    Get currency usage stats
// @access  Private
router.get('/:code/usage', getCurrencyUsage);

// @route   PUT api/currencies/default
// @desc    Set organization default currency
// @access  Private (Admin/Owner)
router.put('/default', setDefaultCurrency);

// @route   GET api/currencies/:id
// @desc    Get single currency
// @access  Private
router.get('/:id', getCurrency);

// @route   POST api/currencies
// @desc    Create new currency
// @access  Private (Admin/Owner)
router.post('/', createCurrency);

// @route   PUT api/currencies/:id
// @desc    Update currency
// @access  Private (Admin/Owner)
router.put('/:id', updateCurrency);

// @route   DELETE api/currencies/:id
// @desc    Delete currency
// @access  Private (Admin/Owner)
router.delete('/:id', deleteCurrency);

module.exports = router;

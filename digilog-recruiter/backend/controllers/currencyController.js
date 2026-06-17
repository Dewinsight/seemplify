const prisma = require('../db/client');

// Inlined from Currency.getUsageCount: count jobs using a currency by status bucket.
// `salary` is a Json column, so the currency is matched via a Json path filter.
async function getCurrencyUsageCount(currencyCode, organizationId) {
  const baseWhere = { salary: { path: ['currency'], equals: currencyCode } };
  if (organizationId) {
    baseWhere.organizationId = organizationId;
  }

  const activeCount = await prisma.job.count({
    where: { ...baseWhere, status: { in: ['draft', 'active', 'paused'] } }
  });
  const archivedCount = await prisma.job.count({
    where: { ...baseWhere, status: { in: ['closed', 'archived'] } }
  });

  return {
    active: activeCount,
    archived: archivedCount,
    total: activeCount + archivedCount
  };
}

// @desc    Get all currencies available for an organization
// @route   GET /api/currencies
// @access  Private
exports.getCurrencies = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization; // ✅ FIXED: Use req.user.currentOrganization
    
    console.log(`📊 Fetching currencies for organization: ${organizationId}`);
    
    const currencies = await prisma.currency.findMany({
      where: {
        OR: [
          { isSystem: true, organizationId: null }, // System currencies
          { organizationId } // Organization-specific currencies
        ]
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] // System currencies first, then alphabetical
    });

    // Get organization's default currency
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    const defaultCurrency = organization?.settings?.defaultCurrency || 'USD';
    
    res.json({
      success: true,
      currencies,
      defaultCurrency,
      count: currencies.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching currencies:', error);
    res.json({
      success: false,
      msg: 'Server error fetching currencies',
      error: error.message
    });
  }
};

// @desc    Get single currency by ID
// @route   GET /api/currencies/:id
// @access  Private
exports.getCurrency = async (req, res) => {
  try {
    const currency = await prisma.currency.findUnique({ where: { id: req.params.id } });

    if (!currency) {
      return res.status(404).json({
        success: false,
        msg: 'Currency not found'
      });
    }

    // Check access: system currencies or own organization
    const organizationId = req.user.currentOrganization; // ✅ FIXED
    if (currency.organizationId && currency.organizationId.toString() !== organizationId.toString()) {
      return res.status(403).json({
        success: false,
        msg: 'Access denied to this currency'
      });
    }
    
    res.json({
      success: true,
      currency
    });
    
  } catch (error) {
    console.error('❌ Error fetching currency:', error);
    res.status(500).json({
      success: false,
      msg: 'Server error fetching currency',
      error: error.message
    });
  }
};

// @desc    Create new currency
// @route   POST /api/currencies
// @access  Private (Admin/Owner)
exports.createCurrency = async (req, res) => {
  try {
    const { code, symbol, name, locale, isSystem } = req.body;
    const organizationId = req.user.currentOrganization; // ✅ FIXED
    const userId = req.user.id;
    
    console.log(`🔍 Creating currency - Org ID: ${organizationId}, User ID: ${userId}`); // Debug log
    
    // Validate required fields
    if (!code || !symbol || !name) {
      return res.status(400).json({
        success: false,
        msg: 'Currency code, symbol, and name are required'
      });
    }
    
    // Validate currency code format (ISO 4217)
    if (!/^[A-Z]{3}$/.test(code.toUpperCase())) {
      return res.status(400).json({
        success: false,
        msg: 'Currency code must be exactly 3 uppercase letters (ISO 4217)'
      });
    }
    
    // Check if currency already exists for this organization
    const existingCurrency = await prisma.currency.findFirst({
      where: {
        code: code.toUpperCase(),
        OR: [
          { organizationId },
          { organizationId: null, isSystem: true }
        ]
      }
    });
    
    if (existingCurrency) {
      return res.status(400).json({
        success: false,
        msg: `Currency ${code} already exists for your organization or as a system currency`
      });
    }
    
    // Only super admins can create system currencies
    const canCreateSystem = req.user.role === 'super_admin';
    
    const currency = await prisma.currency.create({
      data: {
        code: code.toUpperCase(),
        symbol,
        name,
        locale: locale || 'en-US',
        isSystem: canCreateSystem && isSystem === true,
        organizationId: canCreateSystem && isSystem === true ? null : organizationId,
        createdById: userId
      }
    });
    
    console.log(`✅ Currency created: ${currency.code} by user ${userId} for org ${organizationId}`);
    
    res.status(201).json({
      success: true,
      msg: 'Currency created successfully',
      currency
    });
    
  } catch (error) {
    console.error('❌ Error creating currency:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        msg: 'This currency already exists for your organization'
      });
    }
    
    res.status(500).json({
      success: false,
      msg: 'Server error creating currency',
      error: error.message
    });
  }
};

// @desc    Update currency
// @route   PUT /api/currencies/:id
// @access  Private (Admin/Owner)
exports.updateCurrency = async (req, res) => {
  try {
    const { symbol, name, locale } = req.body;
    const organizationId = req.user.currentOrganization; // ✅ FIXED
    
    let currency = await prisma.currency.findUnique({ where: { id: req.params.id } });

    if (!currency) {
      return res.status(404).json({
        success: false,
        msg: 'Currency not found'
      });
    }

    // Check access: cannot edit system currencies, can only edit own org currencies
    if (currency.isSystem) {
      return res.status(403).json({
        success: false,
        msg: 'System currencies cannot be modified'
      });
    }

    if (currency.organizationId.toString() !== organizationId.toString()) {
      return res.status(403).json({
        success: false,
        msg: 'Access denied to this currency'
      });
    }

    // Update fields (cannot change code)
    const updateData = {};
    if (symbol) updateData.symbol = symbol;
    if (name) updateData.name = name;
    if (locale) updateData.locale = locale;

    currency = await prisma.currency.update({ where: { id: currency.id }, data: updateData });
    
    console.log(`✅ Currency updated: ${currency.code}`);
    
    res.json({
      success: true,
      msg: 'Currency updated successfully',
      currency
    });
    
  } catch (error) {
    console.error('❌ Error updating currency:', error);
    res.status(500).json({
      success: false,
      msg: 'Server error updating currency',
      error: error.message
    });
  }
};

// @desc    Delete currency
// @route   DELETE /api/currencies/:id
// @access  Private (Admin/Owner)
exports.deleteCurrency = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization; // ✅ FIXED
    
    const currency = await prisma.currency.findUnique({ where: { id: req.params.id } });

    if (!currency) {
      return res.status(404).json({
        success: false,
        msg: 'Currency not found'
      });
    }

    // Check access
    if (currency.isSystem) {
      return res.status(403).json({
        success: false,
        msg: 'System currencies cannot be deleted'
      });
    }

    if (currency.organizationId.toString() !== organizationId.toString()) {
      return res.status(403).json({
        success: false,
        msg: 'Access denied to this currency'
      });
    }

    // Check if can be deleted (not in use) — inlined from Currency.canBeDeleted/getUsageCount
    const canDelete = await (async () => {
      if (currency.isSystem) {
        return { canDelete: false, reason: 'System currencies cannot be deleted' };
      }
      const usage = await getCurrencyUsageCount(currency.code, currency.organizationId);
      if (usage.active > 0) {
        return {
          canDelete: false,
          reason: `Currency is currently used in ${usage.active} active job(s)`,
          usage
        };
      }
      return { canDelete: true, usage };
    })();

    if (!canDelete.canDelete) {
      return res.status(400).json({
        success: false,
        msg: canDelete.reason,
        usage: canDelete.usage
      });
    }

    await prisma.currency.delete({ where: { id: currency.id } });
    
    console.log(`✅ Currency deleted: ${currency.code}`);
    
    res.json({
      success: true,
      msg: 'Currency deleted successfully',
      currency
    });
    
  } catch (error) {
    console.error('❌ Error deleting currency:', error);
    res.status(500).json({
      success: false,
      msg: 'Server error deleting currency',
      error: error.message
    });
  }
};

// @desc    Get currency usage stats
// @route   GET /api/currencies/:code/usage
// @access  Private
exports.getCurrencyUsage = async (req, res) => {
  try {
    const { code } = req.params;
    const organizationId = req.user.currentOrganization; // ✅ FIXED
    
    const usage = await getCurrencyUsageCount(code, organizationId);
    
    res.json({
      success: true,
      code,
      usage
    });
    
  } catch (error) {
    console.error('❌ Error fetching currency usage:', error);
    res.status(500).json({
      success: false,
      msg: 'Server error fetching currency usage',
      error: error.message
    });
  }
};

// @desc    Set organization default currency
// @route   PUT /api/currencies/default
// @access  Private (Admin/Owner)
exports.setDefaultCurrency = async (req, res) => {
  try {
    const { currencyCode } = req.body;
    const organizationId = req.user.currentOrganization; // ✅ FIXED
    
    if (!currencyCode) {
      return res.status(400).json({
        success: false,
        msg: 'Currency code is required'
      });
    }
    
    // Verify currency exists and is available to organization
    const currency = await prisma.currency.findFirst({
      where: {
        code: currencyCode.toUpperCase(),
        OR: [
          { organizationId },
          { isSystem: true, organizationId: null }
        ]
      }
    });

    if (!currency) {
      return res.status(404).json({
        success: false,
        msg: 'Currency not found or not available for your organization'
      });
    }

    // Update organization default currency
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });

    if (!organization) {
      return res.status(404).json({
        success: false,
        msg: 'Organization not found'
      });
    }

    const settings = organization.settings || {};
    settings.defaultCurrency = currencyCode.toUpperCase();
    await prisma.organization.update({ where: { id: organizationId }, data: { settings } });
    
    console.log(`✅ Default currency set to ${currencyCode} for organization ${organizationId}`);
    
    res.json({
      success: true,
      msg: 'Default currency updated successfully',
      defaultCurrency: currencyCode.toUpperCase()
    });
    
  } catch (error) {
    console.error('❌ Error setting default currency:', error);
    res.status(500).json({
      success: false,
      msg: 'Server error setting default currency',
      error: error.message
    });
  }
};

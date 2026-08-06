const CreditPack = require('../models/CreditPack');
const CreditPurchaseRequest = require('../models/CreditPurchaseRequest');
const Organization = require('../models/Organization');

/**
 * Get all credit packs (admin)
 * @route GET /api/admin/credit-packs
 * @access Private (Admin)
 */
exports.getAllCreditPacks = async (req, res) => {
  try {
    const creditPacks = await CreditPack.find()
      .sort({ displayOrder: 1, price: 1 });
    
    res.json({
      success: true,
      creditPacks
    });
  } catch (error) {
    console.error('Error fetching all credit packs:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error fetching credit packs' 
    });
  }
};

/**
 * Create a new credit pack
 * @route POST /api/admin/credit-packs
 * @access Private (Admin)
 */
exports.createCreditPack = async (req, res) => {
  try {
    const creditPack = new CreditPack(req.body);
    await creditPack.save();
    
    console.log('✅ Admin created credit pack:', creditPack.name);
    
    res.json({
      success: true,
      msg: 'Credit pack created successfully',
      creditPack
    });
  } catch (error) {
    console.error('Error creating credit pack:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error creating credit pack' 
    });
  }
};

/**
 * Update a credit pack
 * @route PUT /api/admin/credit-packs/:id
 * @access Private (Admin)
 */
exports.updateCreditPack = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find the credit pack first
    const creditPack = await CreditPack.findById(id);
    
    if (!creditPack) {
      return res.status(404).json({ 
        success: false,
        msg: 'Credit pack not found' 
      });
    }
    
    // Update fields from request body
    Object.keys(req.body).forEach(key => {
      creditPack[key] = req.body[key];
    });
    
    // Save to trigger pre-save hooks (which calculates totalCredits)
    await creditPack.save();
    
    console.log('✅ Admin updated credit pack:', creditPack.name);
    
    res.json({
      success: true,
      msg: 'Credit pack updated successfully',
      creditPack
    });
  } catch (error) {
    console.error('Error updating credit pack:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error updating credit pack' 
    });
  }
};

/**
 * Delete a credit pack
 * @route DELETE /api/admin/credit-packs/:id
 * @access Private (Admin)
 */
exports.deleteCreditPack = async (req, res) => {
  try {
    const { id } = req.params;
    
    const creditPack = await CreditPack.findByIdAndDelete(id);
    
    if (!creditPack) {
      return res.status(404).json({ 
        success: false,
        msg: 'Credit pack not found' 
      });
    }
    
    console.log('✅ Admin deleted credit pack:', creditPack.name);
    
    res.json({
      success: true,
      msg: 'Credit pack deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting credit pack:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error deleting credit pack' 
    });
  }
};

/**
 * Get all credit purchase requests
 * @route GET /api/admin/credit-purchase-requests
 * @access Private (Admin)
 */
exports.getAllPurchaseRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    const query = {};
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const skip = (page - 1) * limit;
    
    const requests = await CreditPurchaseRequest.find(query)
      .populate('organization', 'name')
      .populate('requestedBy', 'profile.firstName profile.lastName email')
      .populate('creditPack')
      .populate('reviewedBy', 'profile.firstName profile.lastName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);
    
    const totalCount = await CreditPurchaseRequest.countDocuments(query);
    
    res.json({
      success: true,
      requests,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasMore: skip + requests.length < totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching purchase requests:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error fetching purchase requests' 
    });
  }
};

/**
 * Approve a credit purchase request
 * @route PUT /api/admin/credit-purchase-requests/:requestId/approve
 * @access Private (Admin)
 */
exports.approvePurchaseRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reviewNotes } = req.body;
    const adminId = req.admin.id;
    
    const request = await CreditPurchaseRequest.findById(requestId)
      .populate('organization')
      .populate('creditPack');
    
    if (!request) {
      return res.status(404).json({ 
        success: false,
        msg: 'Purchase request not found' 
      });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ 
        success: false,
        msg: 'Only pending requests can be approved' 
      });
    }
    
    // Approve the request
    request.approve(adminId, reviewNotes);
    await request.save();
    
    // Grant credits to the organization
    const organization = await Organization.findById(request.organization._id);
    
    if (!organization.subscription.creditUsage) {
      organization.subscription.creditUsage = {
        totalCredits: 0,
        usedCredits: 0,
        remainingCredits: 0,
        transactions: []
      };
    }
    
    const creditsToAdd = request.packDetails.totalCredits;
    
    // Add credits
    organization.subscription.creditUsage.totalCredits += creditsToAdd;
    organization.subscription.creditUsage.remainingCredits += creditsToAdd;
    
    // Record transaction
    organization.subscription.creditUsage.transactions.push({
      action: 'creditPurchase',
      credits: creditsToAdd,
      entityType: 'system',
      performedBy: adminId,
      timestamp: new Date(),
      balanceAfter: organization.subscription.creditUsage.remainingCredits,
      metadata: {
        requestId: request._id,
        creditPackName: request.packDetails.name,
        creditPackCode: request.packDetails.code,
        price: request.packDetails.price,
        currency: request.packDetails.currency
      }
    });
    
    await organization.save();
    
    // Mark credits as granted
    request.markCreditsGranted();
    await request.save();
    
    console.log('✅ Admin approved credit purchase request:', {
      requestId: request._id,
      organizationId: organization._id,
      organizationName: organization.name,
      creditsGranted: creditsToAdd,
      newBalance: organization.subscription.creditUsage.remainingCredits
    });
    
    res.json({
      success: true,
      msg: 'Purchase request approved and credits granted successfully',
      request,
      creditsGranted: creditsToAdd,
      newCreditBalance: organization.subscription.creditUsage.remainingCredits
    });
  } catch (error) {
    console.error('Error approving purchase request:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error approving purchase request' 
    });
  }
};

/**
 * Reject a credit purchase request
 * @route PUT /api/admin/credit-purchase-requests/:requestId/reject
 * @access Private (Admin)
 */
exports.rejectPurchaseRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reviewNotes } = req.body;
    const adminId = req.admin.id;
    
    const request = await CreditPurchaseRequest.findById(requestId);
    
    if (!request) {
      return res.status(404).json({ 
        success: false,
        msg: 'Purchase request not found' 
      });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ 
        success: false,
        msg: 'Only pending requests can be rejected' 
      });
    }
    
    // Reject the request
    request.reject(adminId, reviewNotes);
    await request.save();
    
    console.log('✅ Admin rejected credit purchase request:', {
      requestId: request._id,
      reviewNotes
    });
    
    res.json({
      success: true,
      msg: 'Purchase request rejected successfully',
      request
    });
  } catch (error) {
    console.error('Error rejecting purchase request:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error rejecting purchase request' 
    });
  }
};

module.exports = exports;


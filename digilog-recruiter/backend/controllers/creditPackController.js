const CreditPack = require('../models/CreditPack');
const CreditPurchaseRequest = require('../models/CreditPurchaseRequest');
const Organization = require('../models/Organization');
const User = require('../models/User');

/**
 * Get all active credit packs
 * @route GET /api/credit-packs
 * @access Public (all authenticated users)
 */
exports.getCreditPacks = async (req, res) => {
  try {
    const creditPacks = await CreditPack.find({ isActive: true })
      .sort({ displayOrder: 1, price: 1 });
    
    res.json({
      success: true,
      creditPacks: creditPacks.map(pack => pack.toPublicJSON())
    });
  } catch (error) {
    console.error('Error fetching credit packs:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error fetching credit packs' 
    });
  }
};

/**
 * Get a specific credit pack by ID or code
 * @route GET /api/credit-packs/:identifier
 * @access Public (all authenticated users)
 */
exports.getCreditPackById = async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Try to find by ID first, then by code
    let creditPack = await CreditPack.findById(identifier);
    
    if (!creditPack) {
      creditPack = await CreditPack.findOne({ code: identifier, isActive: true });
    }
    
    if (!creditPack) {
      return res.status(404).json({ 
        success: false,
        msg: 'Credit pack not found' 
      });
    }
    
    res.json({
      success: true,
      creditPack: creditPack.toPublicJSON()
    });
  } catch (error) {
    console.error('Error fetching credit pack:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error fetching credit pack' 
    });
  }
};

/**
 * Create a credit purchase request
 * @route POST /api/credit-packs/purchase-request
 * @access Private (authenticated users with current organization)
 */
exports.createPurchaseRequest = async (req, res) => {
  try {
    const { creditPackId, notes } = req.body;
    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({ 
        success: false,
        msg: 'No current organization set' 
      });
    }
    
    // Verify credit pack exists and is active
    const creditPack = await CreditPack.findById(creditPackId);
    
    if (!creditPack || !creditPack.isActive) {
      return res.status(404).json({ 
        success: false,
        msg: 'Credit pack not found or not available' 
      });
    }
    
    // Check if there's already a pending request for this org
    const existingRequest = await CreditPurchaseRequest.findOne({
      organization: organizationId,
      creditPack: creditPackId,
      status: 'pending'
    });
    
    if (existingRequest) {
      return res.status(400).json({ 
        success: false,
        msg: 'You already have a pending request for this credit pack' 
      });
    }
    
    // Create the purchase request
    const purchaseRequest = new CreditPurchaseRequest({
      organization: organizationId,
      requestedBy: userId,
      creditPack: creditPackId,
      packDetails: {
        name: creditPack.name,
        code: creditPack.code,
        credits: creditPack.credits,
        bonusCredits: creditPack.bonusCredits,
        totalCredits: creditPack.totalCredits,
        price: creditPack.price,
        currency: creditPack.currency
      },
      notes: notes || ''
    });
    
    await purchaseRequest.save();
    
    console.log('✅ Credit purchase request created:', {
      requestId: purchaseRequest._id,
      organizationId,
      creditPackName: creditPack.name,
      totalCredits: creditPack.totalCredits
    });
    
    res.json({
      success: true,
      msg: 'Credit purchase request submitted successfully',
      request: purchaseRequest
    });
  } catch (error) {
    console.error('Error creating credit purchase request:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error creating purchase request' 
    });
  }
};

/**
 * Get purchase requests for current organization
 * @route GET /api/credit-packs/purchase-requests
 * @access Private (authenticated users with current organization)
 */
exports.getOrganizationPurchaseRequests = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({ 
        success: false,
        msg: 'No current organization set' 
      });
    }
    
    const requests = await CreditPurchaseRequest.find({ 
      organization: organizationId 
    })
      .populate('requestedBy', 'profile.firstName profile.lastName email')
      .populate('creditPack')
      .populate('reviewedBy', 'profile.firstName profile.lastName')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      requests
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
 * Cancel a purchase request
 * @route DELETE /api/credit-packs/purchase-requests/:requestId
 * @access Private (request creator only)
 */
exports.cancelPurchaseRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;
    
    const request = await CreditPurchaseRequest.findById(requestId);
    
    if (!request) {
      return res.status(404).json({ 
        success: false,
        msg: 'Purchase request not found' 
      });
    }
    
    // Only allow cancellation by the requester and only if status is pending
    if (request.requestedBy.toString() !== userId) {
      return res.status(403).json({ 
        success: false,
        msg: 'You can only cancel your own requests' 
      });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ 
        success: false,
        msg: 'Only pending requests can be cancelled' 
      });
    }
    
    request.status = 'cancelled';
    await request.save();
    
    res.json({
      success: true,
      msg: 'Purchase request cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling purchase request:', error);
    res.status(500).json({ 
      success: false,
      msg: 'Server error cancelling purchase request' 
    });
  }
};

module.exports = exports;


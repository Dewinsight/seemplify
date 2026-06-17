const prisma = require('../db/client');
const { isObjectIdLike } = require('../db/objectId');

// Inlined replacement for CreditPack#toPublicJSON (adds the `pricePerCredit` virtual).
const creditPackToPublicJSON = (pack) => {
  if (!pack) return pack;
  const totalCredits = pack.totalCredits;
  const pricePerCredit = (!totalCredits || totalCredits <= 0) ? 0 : (pack.price / totalCredits);
  return { ...pack, pricePerCredit };
};

/**
 * Get all active credit packs
 * @route GET /api/credit-packs
 * @access Public (all authenticated users)
 */
exports.getCreditPacks = async (req, res) => {
  try {
    const creditPacks = await prisma.creditPack.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { price: 'asc' }]
    });

    res.json({
      success: true,
      creditPacks: creditPacks.map(pack => creditPackToPublicJSON(pack))
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
    let creditPack = isObjectIdLike(identifier)
      ? await prisma.creditPack.findUnique({ where: { id: identifier } })
      : null;

    if (!creditPack) {
      creditPack = await prisma.creditPack.findFirst({ where: { code: identifier, isActive: true } });
    }

    if (!creditPack) {
      return res.status(404).json({
        success: false,
        msg: 'Credit pack not found'
      });
    }

    res.json({
      success: true,
      creditPack: creditPackToPublicJSON(creditPack)
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
    const creditPack = isObjectIdLike(creditPackId)
      ? await prisma.creditPack.findUnique({ where: { id: creditPackId } })
      : null;

    if (!creditPack || !creditPack.isActive) {
      return res.status(404).json({
        success: false,
        msg: 'Credit pack not found or not available'
      });
    }

    // Check if there's already a pending request for this org
    const existingRequest = await prisma.creditPurchaseRequest.findFirst({
      where: {
        organizationId: organizationId,
        creditPackId: creditPackId,
        status: 'pending'
      }
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        msg: 'You already have a pending request for this credit pack'
      });
    }

    // Create the purchase request
    const purchaseRequest = await prisma.creditPurchaseRequest.create({
      data: {
        organizationId: organizationId,
        requestedById: userId,
        creditPackId: creditPackId,
        status: 'pending',
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
      }
    });

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
    
    const requests = await prisma.creditPurchaseRequest.findMany({
      where: { organizationId: organizationId },
      orderBy: { createdAt: 'desc' }
    });

    // Stitch soft-ref populates (requestedBy -> User, creditPack -> CreditPack, reviewedBy -> Admin)
    const userIds = [...new Set(requests.map(r => r.requestedById).filter(Boolean))];
    const packIds = [...new Set(requests.map(r => r.creditPackId).filter(Boolean))];
    const adminIds = [...new Set(requests.map(r => r.reviewedById).filter(Boolean))];
    const [users, packs, admins] = await Promise.all([
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, profile: true, email: true } }) : [],
      packIds.length ? prisma.creditPack.findMany({ where: { id: { in: packIds } } }) : [],
      adminIds.length ? prisma.admin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } }) : []
    ]);
    const userMap = new Map(users.map(u => [u.id, u]));
    const packMap = new Map(packs.map(p => [p.id, p]));
    const adminMap = new Map(admins.map(a => [a.id, a]));
    const stitched = requests.map(r => ({
      ...r,
      requestedBy: r.requestedById ? (userMap.get(r.requestedById) || null) : null,
      creditPack: r.creditPackId ? (packMap.get(r.creditPackId) || null) : null,
      reviewedBy: r.reviewedById ? (adminMap.get(r.reviewedById) || null) : null
    }));

    res.json({
      success: true,
      requests: stitched
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
    
    const request = isObjectIdLike(requestId)
      ? await prisma.creditPurchaseRequest.findUnique({ where: { id: requestId } })
      : null;

    if (!request) {
      return res.status(404).json({
        success: false,
        msg: 'Purchase request not found'
      });
    }

    // Only allow cancellation by the requester and only if status is pending
    if ((request.requestedById || '').toString() !== userId) {
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

    await prisma.creditPurchaseRequest.update({
      where: { id: request.id },
      data: { status: 'cancelled' }
    });

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


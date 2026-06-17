const prisma = require('../db/client');
const { isObjectIdLike } = require('../db/objectId');

// Recompute the totalCredits field that the Mongoose pre-save hook used to derive.
const computeTotalCredits = (credits, bonusCredits) =>
  (Number(credits) || 0) + (Number(bonusCredits) || 0);

/**
 * Get all credit packs (admin)
 * @route GET /api/admin/credit-packs
 * @access Private (Admin)
 */
exports.getAllCreditPacks = async (req, res) => {
  try {
    const creditPacks = await prisma.creditPack.findMany({
      orderBy: [{ displayOrder: 'asc' }, { price: 'asc' }]
    });

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
    const data = { ...req.body };
    // Replicate the pre-save hook that computed totalCredits.
    data.totalCredits = computeTotalCredits(data.credits, data.bonusCredits);
    const creditPack = await prisma.creditPack.create({ data });

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
    const existing = isObjectIdLike(id)
      ? await prisma.creditPack.findUnique({ where: { id } })
      : null;

    if (!existing) {
      return res.status(404).json({
        success: false,
        msg: 'Credit pack not found'
      });
    }

    // Update fields from request body
    const data = { ...req.body };
    // Recompute totalCredits the way the pre-save hook did.
    const nextCredits = data.credits !== undefined ? data.credits : existing.credits;
    const nextBonus = data.bonusCredits !== undefined ? data.bonusCredits : existing.bonusCredits;
    data.totalCredits = computeTotalCredits(nextCredits, nextBonus);

    const creditPack = await prisma.creditPack.update({ where: { id }, data });

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
    
    const creditPack = isObjectIdLike(id)
      ? await prisma.creditPack.findUnique({ where: { id } })
      : null;

    if (!creditPack) {
      return res.status(404).json({
        success: false,
        msg: 'Credit pack not found'
      });
    }

    await prisma.creditPack.delete({ where: { id } });

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

    const [rawRequests, totalCount] = await Promise.all([
      prisma.creditPurchaseRequest.findMany({
        where: query,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip
      }),
      prisma.creditPurchaseRequest.count({ where: query })
    ]);

    // Stitch soft-ref populates (organization, requestedBy -> User, creditPack, reviewedBy -> Admin)
    const orgIds = [...new Set(rawRequests.map(r => r.organizationId).filter(Boolean))];
    const userIds = [...new Set(rawRequests.map(r => r.requestedById).filter(Boolean))];
    const packIds = [...new Set(rawRequests.map(r => r.creditPackId).filter(Boolean))];
    const adminIds = [...new Set(rawRequests.map(r => r.reviewedById).filter(Boolean))];
    const [orgs, users, packs, admins] = await Promise.all([
      orgIds.length ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, profile: true, email: true } }) : [],
      packIds.length ? prisma.creditPack.findMany({ where: { id: { in: packIds } } }) : [],
      adminIds.length ? prisma.admin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } }) : []
    ]);
    const orgMap = new Map(orgs.map(o => [o.id, o]));
    const userMap = new Map(users.map(u => [u.id, u]));
    const packMap = new Map(packs.map(p => [p.id, p]));
    const adminMap = new Map(admins.map(a => [a.id, a]));
    const requests = rawRequests.map(r => ({
      ...r,
      organization: r.organizationId ? (orgMap.get(r.organizationId) || null) : null,
      requestedBy: r.requestedById ? (userMap.get(r.requestedById) || null) : null,
      creditPack: r.creditPackId ? (packMap.get(r.creditPackId) || null) : null,
      reviewedBy: r.reviewedById ? (adminMap.get(r.reviewedById) || null) : null
    }));

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
    
    let request = isObjectIdLike(requestId)
      ? await prisma.creditPurchaseRequest.findUnique({ where: { id: requestId } })
      : null;

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

    // Approve the request (inlines CreditPurchaseRequest#approve)
    request = await prisma.creditPurchaseRequest.update({
      where: { id: request.id },
      data: {
        status: 'approved',
        reviewedById: adminId,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes || ''
      }
    });

    // Grant credits to the organization (subscription is a Json column -> read-modify-write)
    const organization = await prisma.organization.findUnique({ where: { id: request.organizationId } });

    const subscription = organization.subscription || {};
    if (!subscription.creditUsage) {
      subscription.creditUsage = {
        totalCredits: 0,
        usedCredits: 0,
        remainingCredits: 0,
        transactions: []
      };
    }

    const creditsToAdd = request.packDetails.totalCredits;

    // Add credits
    subscription.creditUsage.totalCredits += creditsToAdd;
    subscription.creditUsage.remainingCredits += creditsToAdd;

    // Record transaction
    subscription.creditUsage.transactions.push({
      action: 'creditPurchase',
      credits: creditsToAdd,
      entityType: 'system',
      performedBy: adminId,
      timestamp: new Date(),
      balanceAfter: subscription.creditUsage.remainingCredits,
      metadata: {
        requestId: request.id,
        creditPackName: request.packDetails.name,
        creditPackCode: request.packDetails.code,
        price: request.packDetails.price,
        currency: request.packDetails.currency
      }
    });

    await prisma.organization.update({
      where: { id: organization.id },
      data: { subscription }
    });

    // Mark credits as granted (inlines CreditPurchaseRequest#markCreditsGranted)
    request = await prisma.creditPurchaseRequest.update({
      where: { id: request.id },
      data: { creditsGranted: true, grantedAt: new Date() }
    });

    console.log('✅ Admin approved credit purchase request:', {
      requestId: request.id,
      organizationId: organization.id,
      organizationName: organization.name,
      creditsGranted: creditsToAdd,
      newBalance: subscription.creditUsage.remainingCredits
    });

    res.json({
      success: true,
      msg: 'Purchase request approved and credits granted successfully',
      request,
      creditsGranted: creditsToAdd,
      newCreditBalance: subscription.creditUsage.remainingCredits
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
    
    let request = isObjectIdLike(requestId)
      ? await prisma.creditPurchaseRequest.findUnique({ where: { id: requestId } })
      : null;

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

    // Reject the request (inlines CreditPurchaseRequest#reject)
    request = await prisma.creditPurchaseRequest.update({
      where: { id: request.id },
      data: {
        status: 'rejected',
        reviewedById: adminId,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes || ''
      }
    });

    console.log('✅ Admin rejected credit purchase request:', {
      requestId: request.id,
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


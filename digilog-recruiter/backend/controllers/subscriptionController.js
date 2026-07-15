const SubscriptionRequest = require('../models/SubscriptionRequest');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Admin = require('../models/Admin');
const Plan = require('../models/Plan');
const emailService = require('../services/emailService');
const pdfService = require('../services/pdfService');
const path = require('path');
const { resolveOrganizationForEmail } = require('../utils/organizationEmailContext');
const { decodeHtmlEntities } = require('../utils/htmlDecode');

function documentId(value) {
  return value?._id || value || null;
}

async function resolveSubscriptionOrganization(request, organization = null) {
  if (!request?.organizationId) {
    return null;
  }

  const resolved = await resolveOrganizationForEmail({
    organization: organization || request.organizationId,
    organizationId: documentId(request.organizationId)
  });
  resolved.name = decodeHtmlEntities(resolved.name);
  return resolved;
}

function organizationEmailOptions(organization, options = {}) {
  return organization
    ? { ...options, organizationName: organization.name }
    : options;
}

/**
 * Helper function to grant credits from a plan to an organization
 * @param {String} organizationId - Organization ID
 * @param {String} planCode - Plan code (e.g., 'free', 'basic', 'pro')
 * @param {String} reason - Reason for credit grant (for transaction history)
 * @param {String} performedBy - ID of admin/user who triggered this (optional)
 * @returns {Object} { success: Boolean, creditsGranted: Number, newBalance: Number, message: String }
 */
async function grantPlanCredits(organizationId, planCode, reason = 'Plan subscription', performedBy = null) {
  try {
    console.log(`💳 Granting credits from plan "${planCode}" to organization ${organizationId}`);
    
    // Fetch the plan
    const plan = await Plan.findOne({ code: planCode.toLowerCase() });
    if (!plan) {
      console.error(`❌ Plan not found: ${planCode}`);
      return { 
        success: false, 
        creditsGranted: 0, 
        newBalance: 0, 
        message: `Plan "${planCode}" not found` 
      };
    }
    
    const creditsToGrant = plan.credits?.totalCredits || 0;
    if (creditsToGrant === 0) {
      console.warn(`⚠️ Plan "${planCode}" has 0 credits configured`);
      return { 
        success: false, 
        creditsGranted: 0, 
        newBalance: 0, 
        message: `Plan "${planCode}" has no credits configured` 
      };
    }
    
    // Fetch organization
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      console.error(`❌ Organization not found: ${organizationId}`);
      return { 
        success: false, 
        creditsGranted: 0, 
        newBalance: 0, 
        message: 'Organization not found' 
      };
    }
    
    // Initialize creditUsage if it doesn't exist
    if (!organization.subscription) {
      organization.subscription = {};
    }
    
    if (!organization.subscription.creditUsage) {
      organization.subscription.creditUsage = {
        totalCredits: 0,
        usedCredits: 0,
        remainingCredits: 0,
        currentCycleStart: new Date(),
        currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        transactions: [],
        rolloverCredits: 0,
        creditPurchases: [],
        lowCreditWarning: {
          enabled: true,
          threshold: 20
        }
      };
    }
    
    // TOP UP: Add credits to existing balance
    organization.subscription.creditUsage.totalCredits = creditsToGrant; // Set base allocation
    organization.subscription.creditUsage.remainingCredits += creditsToGrant; // Add to current balance
    
    const newBalance = organization.subscription.creditUsage.remainingCredits;
    
    // Record transaction
    organization.subscription.creditUsage.transactions.push({
      action: 'creditPurchase',  // Using creditPurchase for plan credit grants
      credits: creditsToGrant,
      entityType: 'system',
      performedBy: performedBy,
      timestamp: new Date(),
      balanceAfter: newBalance,
      metadata: {
        reason: reason,
        planCode: planCode,
        planName: plan.name,
        description: `${reason}: Granted ${creditsToGrant} credits from ${plan.name} plan`
      }
    });
    
    await organization.save();
    
    console.log(`✅ Granted ${creditsToGrant} credits to organization ${organization.name}. New balance: ${newBalance}`);
    
    return {
      success: true,
      creditsGranted: creditsToGrant,
      newBalance: newBalance,
      message: `Successfully granted ${creditsToGrant} credits from ${plan.name} plan`
    };
    
  } catch (error) {
    console.error('❌ Error granting plan credits:', error);
    return {
      success: false,
      creditsGranted: 0,
      newBalance: 0,
      message: error.message || 'Error granting credits'
    };
  }
}

// Create a new subscription upgrade request
exports.createUpgradeRequest = async (req, res) => {
  try {
    const { requestType, organizationId, requestedPlan, notes } = req.body;
    
    // Debug logging for authentication data
    console.log('Authentication data in request:', {
      user: req.user,
      hasUserId: req.user && req.user.id ? 'yes' : 'no'
    });
    
    // Check if user exists in the request
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required - user not found in request'
      });
    }
    
    // Check if user ID exists in the request
    if (!req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required - user ID not found'
      });
    }
    
    const userId = req.user.id;

    // Validate request data
    if (!requestType || !requestedPlan) {
      return res.status(400).json({
        success: false,
        message: 'Request type and requested plan are required'
      });
    }
    
    // Verify the requested plan exists and is published
    const plan = await Plan.findOne({ code: requestedPlan, isPublished: true });
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: `The requested plan "${requestedPlan}" does not exist or is not available`
      });
    }
    
    // Only organization plans are supported now
    if (requestType === 'user') {
      return res.status(400).json({
        success: false,
        message: 'User subscription requests are no longer supported. Only organization plans are available.'
      });
    }
    
    if (plan.planType !== 'organization') {
      return res.status(400).json({
        success: false,
        message: `The requested plan "${requestedPlan}" is not a valid organization plan`
      });
    }

    // Check if there's already a pending request
    const existingRequest = await SubscriptionRequest.findOne({
      userId,
      ...(requestType === 'organization' ? { organizationId } : {}),
      status: 'pending'
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending upgrade request',
        requestId: existingRequest._id
      });
    }

    // Get current plan information - only organization plans are supported
    let currentPlan = '';
    
    if (requestType === 'organization') {
      // Verify user belongs to this organization
      const organization = await Organization.findOne({
        _id: organizationId,
        $or: [
          { owner: userId },
          { members: { $elemMatch: { userId, role: 'admin' } } }
        ]
      });

      if (!organization) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to request upgrades for this organization'
        });
      }

      currentPlan = organization?.subscription?.plan || '';
      
      // If organization has no plan or invalid plan, find default organization plan
      if (!currentPlan) {
        const defaultPlan = await Plan.findOne({ 
          planType: 'organization', 
          isDefault: true,
          isPublished: true
        });
        
        if (defaultPlan) {
          currentPlan = defaultPlan.code;
        } else {
          // Last resort fallback if no default plan exists
          return res.status(500).json({
            success: false,
            message: 'No default organization plan defined in the system'
          });
        }
      }
    }

    // Create the request
    const subscriptionRequest = new SubscriptionRequest({
      requestType,
      userId,
      organizationId: requestType === 'organization' ? organizationId : null,
      currentPlan,
      requestedPlan,
      notes,
      status: 'pending'
    });

    await subscriptionRequest.save();

    // Notify admins of new request
    try {
      const admins = await Admin.find({ isSuperAdmin: true });
      for (const admin of admins) {
        await emailService.sendAdminNotification(
          admin.email,
          'New Subscription Upgrade Request',
          `A new ${requestType} subscription upgrade request has been submitted from ${currentPlan} to ${requestedPlan}.`
        );
      }
    } catch (emailError) {
      console.error('Failed to send admin notification:', emailError);
      // Continue with the process even if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Subscription upgrade request submitted successfully',
      requestId: subscriptionRequest._id,
      request: subscriptionRequest
    });

  } catch (error) {
    console.error('Error creating subscription request:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting subscription request',
      error: error.message
    });
  }
};

// Get all subscription requests for a user
exports.getUserRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const requests = await SubscriptionRequest.find({ userId })
      .sort({ createdAt: -1 })
      .populate('organizationId', 'name')
      .populate('approvedBy', 'name email');

    res.status(200).json({
      success: true,
      count: requests.length,
      requests
    });

  } catch (error) {
    console.error('Error getting user subscription requests:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving subscription requests',
      error: error.message
    });
  }
};

// Get all subscription requests for an organization
exports.getOrganizationRequests = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const userId = req.user.id;

    // Verify user has permission to view org requests
    const organization = await Organization.findOne({
      _id: organizationId,
      $or: [
        { owner: userId },
        { members: { $elemMatch: { userId, role: { $in: ['admin', 'owner'] } } } }
      ]
    });

    if (!organization) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view requests for this organization'
      });
    }

    const requests = await SubscriptionRequest.find({ 
      organizationId,
      requestType: 'organization'
    })
      .sort({ createdAt: -1 })
      .populate('userId', 'firstName lastName email')
      .populate('approvedBy', 'name email');

    res.status(200).json({
      success: true,
      count: requests.length,
      requests
    });

  } catch (error) {
    console.error('Error getting organization subscription requests:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving organization subscription requests',
      error: error.message
    });
  }
};

// Cancel a pending subscription request
exports.cancelRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;

    const request = await SubscriptionRequest.findOne({
      _id: requestId,
      userId,
      status: 'pending'
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found or cannot be cancelled'
      });
    }

    await SubscriptionRequest.findByIdAndDelete(requestId);

    res.status(200).json({
      success: true,
      message: 'Subscription request cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling subscription request:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling subscription request',
      error: error.message
    });
  }
};

// Admin endpoints
// Get all subscription requests (admin only)
exports.getAllRequests = async (req, res) => {
  try {
    const { status, type } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (type) query.requestType = type;

    const requests = await SubscriptionRequest.find(query)
      .sort({ createdAt: -1 })
      .populate('userId', 'firstName lastName email')
      .populate('organizationId', 'name')
      .populate('approvedBy', 'name email');

    res.status(200).json({
      success: true,
      count: requests.length,
      requests
    });

  } catch (error) {
    console.error('Error getting all subscription requests:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving subscription requests',
      error: error.message
    });
  }
};

// Generate and get invoice for a subscription request
exports.generateInvoice = async (req, res) => {
  try {
    const { requestId } = req.params;
    
    // Find the subscription request
    const request = await SubscriptionRequest.findById(requestId);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Subscription request not found'
      });
    }
    
    // Check if request has invoice status
    if (request.status !== 'invoiced' || !request.invoiceDetails) {
      return res.status(400).json({
        success: false,
        message: 'No invoice available for this request'
      });
    }
    
    // Get user and organization data
    const user = await User.findById(request.userId);
    let organization = null;
    
    if (request.organizationId) {
      organization = await Organization.findById(request.organizationId);
      organization = await resolveSubscriptionOrganization(request, organization);
    }
    
    // Generate PDF
    const pdfDetails = await pdfService.generateInvoicePdf(request, user, organization);
    
    // Update request with invoice URL if not already set
    if (!request.invoiceDetails.invoiceUrl) {
      request.invoiceDetails.invoiceUrl = `/api/subscription/invoice/${request._id}/pdf`;
      await request.save();
    }
    
    res.json({
      success: true,
      message: 'Invoice generated successfully',
      invoiceUrl: `/api/subscription/invoice/${request._id}/pdf`,
      invoiceNumber: pdfDetails.invoiceId
    });
    
  } catch (error) {
    console.error('Error generating invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating invoice',
      error: error.message
    });
  }
};

// Get invoice PDF file
exports.getInvoicePdf = async (req, res) => {
  try {
    const { requestId } = req.params;
    
    // Find the subscription request
    const request = await SubscriptionRequest.findById(requestId);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Subscription request not found'
      });
    }
    
    // Check if request has invoice status
    if (request.status !== 'invoiced' || !request.invoiceDetails) {
      return res.status(400).json({
        success: false,
        message: 'No invoice available for this request'
      });
    }
    
    // Get user and organization data
    const user = await User.findById(request.userId);
    let organization = null;
    
    if (request.organizationId) {
      organization = await Organization.findById(request.organizationId);
      organization = await resolveSubscriptionOrganization(request, organization);
    }
    
    // Generate PDF on-the-fly
    const pdfDetails = await pdfService.generateInvoicePdf(request, user, organization);
    
    // Set headers and send file
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfDetails.fileName}"`);
    
    // Send the file
    res.sendFile(pdfDetails.filePath);
    
  } catch (error) {
    console.error('Error retrieving invoice PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving invoice PDF',
      error: error.message
    });
  }
};

// Send invoice email with PDF
exports.emailInvoice = async (req, res) => {
  try {
    const { requestId } = req.params;
    
    // Find the subscription request with populated user
    const request = await SubscriptionRequest.findById(requestId)
      .populate('userId', 'email profile');
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Subscription request not found'
      });
    }
    
    // Check if request has invoice status
    if (request.status !== 'invoiced' || !request.invoiceDetails) {
      return res.status(400).json({
        success: false,
        message: 'No invoice available for this request'
      });
    }
    
    // Get organization data if needed
    let organization = null;
    if (request.organizationId) {
      organization = await Organization.findById(request.organizationId);
      organization = await resolveSubscriptionOrganization(request, organization);
    }
    
    // Generate PDF
    const pdfDetails = await pdfService.generateInvoicePdf(request, request.userId, organization);
    
    // Read the PDF file for attaching
    const fs = require('fs');
    const invoiceContent = fs.readFileSync(pdfDetails.filePath);
    const invoiceBase64 = invoiceContent.toString('base64');
    
    // Current plan and requested plan info
    const currentPlanName = request.currentPlan.charAt(0).toUpperCase() + request.currentPlan.slice(1);
    const requestedPlanName = request.requestedPlan.charAt(0).toUpperCase() + request.requestedPlan.slice(1);
    
    // Format the email content nicely
    const emailContent = `
      <h2>Your SmartHR Subscription Upgrade Invoice</h2>
      
      <p>Dear ${request.userId.profile?.firstName || 'User'},</p>
      
      <p>Thank you for upgrading your subscription. Your invoice for the ${requestedPlanName} plan 
      upgrade is attached to this email.</p>
      
      <div style="margin: 25px 0; padding: 20px; border: 1px solid #e5e5e5; border-radius: 8px; background-color: #f9fafb;">
        <h3 style="margin-top: 0; color: #333;">Invoice Details:</h3>
        
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666;">Invoice Number:</td>
            <td style="padding: 8px 0; font-weight: bold;">${request.invoiceDetails.invoiceNumber || pdfDetails.invoiceId}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Plan Upgrade:</td>
            <td style="padding: 8px 0; font-weight: bold;">${currentPlanName} → ${requestedPlanName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Amount:</td>
            <td style="padding: 8px 0; font-weight: bold;">${request.invoiceDetails.currency || 'USD'} ${request.invoiceDetails.amount}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Due Date:</td>
            <td style="padding: 8px 0; font-weight: bold;">${new Date(request.invoiceDetails.dueDate).toLocaleDateString()}</td>
          </tr>
        </table>
      </div>
      
      <p>If you have any questions regarding this invoice or your subscription, please don't 
      hesitate to contact our support team.</p>
      
      <p>We appreciate your business!</p>
    `;
    
    // Setup email with PDF attachment according to Brevo API format
    // Brevo API expects: { url: string } or { content: string, name: string }
    const attachments = [{
      content: invoiceBase64,
      name: pdfDetails.fileName
    }];
    
    await emailService.sendUserNotification(
      request.userId.email,
      `Invoice for Subscription Upgrade - ${request.invoiceDetails.invoiceNumber || pdfDetails.invoiceId}`,
      emailContent,
      organizationEmailOptions(organization, { attachments })
    );
    
    // Update request with sent timestamp
    request.invoiceDetails.invoiceSentAt = Date.now();
    await request.save();
    
    res.json({
      success: true,
      message: 'Invoice email sent successfully with attachment',
    });
    
  } catch (error) {
    console.error('Error sending invoice email:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending invoice email',
      error: error.message
    });
  }
};

// Update request status (admin only)
exports.updateRequestStatus = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, adminNotes, invoiceDetails } = req.body;
    const adminId = req.admin.id;

    if (!['pending', 'approved', 'rejected', 'invoiced'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const request = await SubscriptionRequest.findById(requestId);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Subscription request not found'
      });
    }

    // Update request
    request.status = status;
    if (adminNotes) request.adminNotes = adminNotes;
    
    if (status === 'approved') {
      request.approvedBy = adminId;
      request.approvalDate = Date.now();
      
      // Update the actual subscription plan
      if (request.requestType === 'user') {
        await User.findByIdAndUpdate(request.userId, {
          'subscription.plan': request.requestedPlan,
          'subscription.updatedAt': Date.now(),
          'subscription.startDate': Date.now()
        });
      } else if (request.requestType === 'organization') {
        await Organization.findByIdAndUpdate(request.organizationId, {
          'subscription.plan': request.requestedPlan,
          'subscription.updatedAt': Date.now(),
          'subscription.startDate': Date.now()
        });
        
        // Grant credits from the new plan (TOP UP behavior)
        console.log(`💳 Granting credits for approved plan: ${request.requestedPlan}`);
        const creditResult = await grantPlanCredits(
          request.organizationId,
          request.requestedPlan,
          'Subscription plan upgrade approved',
          adminId
        );
        
        if (creditResult.success) {
          console.log(`✅ Credits granted: ${creditResult.creditsGranted}, New balance: ${creditResult.newBalance}`);
          // Store credit info in request for reference
          request.creditInfo = {
            creditsGranted: creditResult.creditsGranted,
            newBalance: creditResult.newBalance
          };
        } else {
          console.error(`❌ Failed to grant credits: ${creditResult.message}`);
        }
      }
    } else if (status === 'invoiced' && invoiceDetails) {
      request.invoiceDetails = {
        ...invoiceDetails,
        paid: false
      };
    }

    await request.save();

    // Notify user of status change
    try {
      const user = await User.findById(request.userId);
      if (user && user.email) {
        const organization = await resolveSubscriptionOrganization(request);
        let emailSubject, emailContent;
        
        if (status === 'approved') {
          emailSubject = 'Your Subscription Upgrade Request was Approved';
          emailContent = `Great news! Your request to upgrade to the ${request.requestedPlan} plan has been approved.`;
        } else if (status === 'rejected') {
          emailSubject = 'Your Subscription Upgrade Request was Declined';
          emailContent = `We're sorry, but your request to upgrade to the ${request.requestedPlan} plan was declined.${adminNotes ? ` Reason: ${adminNotes}` : ''}`;
        } else if (status === 'invoiced') {
          emailSubject = 'Invoice for Your Subscription Upgrade Request';
          emailContent = `An invoice has been generated for your subscription upgrade request. Please review and complete the payment process.`;
        }
        
        await emailService.sendUserNotification(
          user.email,
          emailSubject,
          emailContent,
          organizationEmailOptions(organization)
        );
      }
    } catch (emailError) {
      console.error('Failed to send user notification:', emailError);
      // Continue even if email fails
    }

    res.status(200).json({
      success: true,
      message: `Subscription request status updated to ${status}`,
      request
    });

  } catch (error) {
    console.error('Error updating subscription request:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating subscription request',
      error: error.message
    });
  }
};

// Mark invoice as paid (admin only)
exports.markInvoicePaid = async (req, res) => {
  try {
    const { requestId } = req.params;
    const adminId = req.admin.id;

    const request = await SubscriptionRequest.findById(requestId);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Subscription request not found'
      });
    }

    if (request.status !== 'invoiced') {
      return res.status(400).json({
        success: false,
        message: 'Request is not in invoiced status'
      });
    }

    // Update invoice status and approve the request
    request.invoiceDetails.paid = true;
    request.status = 'approved';
    request.approvedBy = adminId;
    request.approvalDate = Date.now();
    
    await request.save();

    // Update the actual subscription plan
    if (request.requestType === 'user') {
      await User.findByIdAndUpdate(request.userId, {
        'subscription.plan': request.requestedPlan,
        'subscription.updatedAt': Date.now(),
        'subscription.startDate': Date.now()
      });
    } else if (request.requestType === 'organization') {
      await Organization.findByIdAndUpdate(request.organizationId, {
        'subscription.plan': request.requestedPlan,
        'subscription.updatedAt': Date.now(),
        'subscription.startDate': Date.now()
      });
      
      // Grant credits from the new plan (TOP UP behavior)
      console.log(`💳 Granting credits after invoice payment: ${request.requestedPlan}`);
      const creditResult = await grantPlanCredits(
        request.organizationId,
        request.requestedPlan,
        'Subscription plan upgrade (invoice paid)',
        adminId
      );
      
      if (creditResult.success) {
        console.log(`✅ Credits granted after payment: ${creditResult.creditsGranted}, New balance: ${creditResult.newBalance}`);
        // Store credit info in request for reference
        request.creditInfo = {
          creditsGranted: creditResult.creditsGranted,
          newBalance: creditResult.newBalance
        };
        await request.save();
      } else {
        console.error(`❌ Failed to grant credits after payment: ${creditResult.message}`);
      }
    }

    // Notify user
    try {
      const user = await User.findById(request.userId);
      if (user && user.email) {
        const organization = await resolveSubscriptionOrganization(request);
        const emailSubject = 'Your Subscription Has Been Upgraded';
        const emailContent = `Your payment for the ${request.requestedPlan} plan has been received and your subscription has been upgraded.`;
        await emailService.sendUserNotification(
          user.email,
          emailSubject,
          emailContent,
          organizationEmailOptions(organization)
        );
      }
    } catch (emailError) {
      console.error('Failed to send user notification:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Invoice marked as paid and subscription upgraded',
      request
    });

  } catch (error) {
    console.error('Error marking invoice as paid:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking invoice as paid',
      error: error.message
    });
  }
};

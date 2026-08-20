const grantVerificationService = require('../services/grantVerificationService');
const User = require('../models/User');
const grantManagementService = require('../services/grantManagementService');

/**
 * Check if the current user's grant is valid
 */
const checkGrantStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const status = await grantVerificationService.getGrantStatus(userId);
    
    res.json({
      success: true,
      status: status
    });
  } catch (error) {
    console.error('Error checking grant status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check grant status',
      details: error.message
    });
  }
};

/**
 * Get live calendar-provider capacity for the authenticated scheduling flow.
 */
const getGrantUsage = async (req, res) => {
  try {
    const usage = await grantManagementService.getSystemGrantUsageStats();
    res.json({ success: true, usage });
  } catch (error) {
    console.error('Error getting calendar grant usage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get calendar grant usage'
    });
  }
};

/**
 * Verify the current user's grant with the OAuth provider
 */
const verifyGrant = async (req, res) => {
  try {
    const userId = req.user.id;
    const verification = await grantVerificationService.verifyUserGrant(userId);
    
    if (verification.valid) {
      res.json({
        success: true,
        message: 'Grant is valid',
        grantInfo: verification.grantInfo
      });
    } else {
      res.status(verification.requiresReauth ? 401 : 400).json({
        success: false,
        error: verification.error,
        requiresReauth: verification.requiresReauth,
        temporaryError: verification.temporaryError
      });
    }
  } catch (error) {
    console.error('Error verifying grant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify grant',
      details: error.message
    });
  }
};

/**
 * Generate a re-authentication URL for the current user
 */
const generateReauthUrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { provider, forceAccountSelection = false } = req.body || {};
    
    const result = await grantVerificationService.generateReauthUrl(userId, provider, forceAccountSelection);
    
    res.json({
      success: true,
      authUrl: result.authUrl,
      message: forceAccountSelection 
        ? 'Re-authentication URL generated. You can select a different account during sign-in.'
        : 'Re-authentication URL generated. Please complete the OAuth flow to reconnect your calendar.'
    });
  } catch (error) {
    console.error('Error generating reauth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate re-authentication URL',
      details: error.message
    });
  }
};

/**
 * Handle OAuth callback for re-authentication
 */
const handleReauthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing authorization code or state parameter'
      });
    }
    
    const result = await grantVerificationService.handleReauthCallback(code, state);
    
    if (result.success) {
      // Return success page with postMessage support
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Calendar Reconnected</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              text-align: center; 
              padding: 50px; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              margin: 0;
              min-height: 100vh;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
            }
            .success { 
              background: rgba(255, 255, 255, 0.1); 
              padding: 30px; 
              border-radius: 10px;
              backdrop-filter: blur(10px);
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            }
            .checkmark {
              width: 60px;
              height: 60px;
              border-radius: 50%;
              background: #28a745;
              margin: 0 auto 20px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 30px;
              animation: checkmark 0.6s ease-in-out;
            }
            @keyframes checkmark {
              0% { transform: scale(0); }
              50% { transform: scale(1.2); }
              100% { transform: scale(1); }
            }
          </style>
        </head>
        <body>
          <div class="success">
            <div class="checkmark">✓</div>
            <h2>Calendar Reconnected!</h2>
            <p>Your calendar access has been restored.</p>
          </div>
          
          <script>
            const message = {
              type: 'oauth_success',
              action: 'reauth',
              timestamp: new Date().toISOString()
            };
            
            // Send success message to parent window
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(message, '*');
              setTimeout(() => window.close(), 2000);
            } else if (window.parent && window.parent !== window) {
              window.parent.postMessage(message, '*');
            } else {
              // Fallback redirect
              setTimeout(() => {
                window.location.href = '${process.env.FRONTEND_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://app.seemplifyai.com')}/calendar?reauth=success';
              }, 2000);
            }
          </script>
        </body>
        </html>
      `);
    } else {
      throw new Error('Re-authentication failed');
    }
  } catch (error) {
    console.error('Error handling reauth callback:', error);
    
    // Return error page with postMessage support
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reconnection Failed</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
            color: white;
            margin: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
          }
          .error { 
            background: rgba(255, 255, 255, 0.1); 
            padding: 30px; 
            border-radius: 10px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
          }
          .error-icon {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: #dc3545;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 30px;
          }
        </style>
      </head>
      <body>
        <div class="error">
          <div class="error-icon">✗</div>
          <h2>Reconnection Failed</h2>
          <p>There was an error reconnecting your calendar.</p>
          <p>Please try again.</p>
        </div>
        
        <script>
          const errorMessage = {
            type: 'oauth_error',
            action: 'reauth',
            error: 'Re-authentication failed: ${error.message}',
            timestamp: new Date().toISOString()
          };
          
          // Send error message to parent window
          if (window.opener && window.opener !== window) {
            window.opener.postMessage(errorMessage, '*');
            setTimeout(() => window.close(), 3000);
          } else if (window.parent && window.parent !== window) {
            window.parent.postMessage(errorMessage, '*');
          } else {
            // Fallback redirect
            setTimeout(() => {
              window.location.href = '${process.env.FRONTEND_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://app.seemplifyai.com')}/calendar?reauth=error&message=${encodeURIComponent(error.message)}';
            }, 3000);
          }
        </script>
      </body>
      </html>
    `);
  }
};

/**
 * Admin endpoint: Verify all user grants
 */
const verifyAllGrants = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
    
    const results = await grantVerificationService.verifyAllUserGrants();
    
    res.json({
      success: true,
      message: 'Grant verification completed',
      results: results
    });
  } catch (error) {
    console.error('Error verifying all grants:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify all grants',
      details: error.message
    });
  }
};

/**
 * Force refresh a user's grant (admin only)
 */
const forceGrantRefresh = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
    
    const { userId } = req.params;
    const verification = await grantVerificationService.verifyUserGrant(userId);
    
    res.json({
      success: true,
      message: 'Grant verification forced',
      verification: verification
    });
  } catch (error) {
    console.error('Error forcing grant refresh:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to force grant refresh',
      details: error.message
    });
  }
};

/**
 * Revoke and clear a user's grant
 */
const revokeGrant = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Revoke in Nylas and clear local grant metadata
    const revocationResult = await grantManagementService.revokeGrant(
      userId,
      'Calendar access manually revoked',
      true
    );
    
    // Cancel future interviews
    const cancellationResult = await grantVerificationService.cancelInterviewsForInvalidGrant(
      userId, 
      'Calendar access manually revoked'
    );
    
    res.json({
      success: true,
      message: 'Grant revoked successfully',
      cancelledInterviews: cancellationResult.cancelledCount,
      revokedInNylas: Boolean(revocationResult.revokedInNylas)
    });
  } catch (error) {
    console.error('Error revoking grant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to revoke grant',
      details: error.message
    });
  }
};

/**
 * Get grant verification history for debugging
 */
const getGrantHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select(
      'nylasGrantStatus calendarConnected lastGrantRefresh lastGrantExpiry lastGrantRevocation'
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      history: {
        currentStatus: user.nylasGrantStatus,
        calendarConnected: user.calendarConnected,
        lastRefresh: user.lastGrantRefresh,
        lastExpiry: user.lastGrantExpiry,
        lastRevocation: user.lastGrantRevocation
      }
    });
  } catch (error) {
    console.error('Error getting grant history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get grant history',
      details: error.message
    });
  }
};

module.exports = {
  checkGrantStatus,
  getGrantUsage,
  verifyGrant,
  generateReauthUrl,
  handleReauthCallback,
  verifyAllGrants,
  forceGrantRefresh,
  revokeGrant,
  getGrantHistory
}; 

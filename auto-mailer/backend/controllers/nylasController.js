import { User } from '../models/User.js';
import { Email } from '../models/Email.js';
import NylasService from '../services/nylasService.js';
import crypto from 'crypto';

export const initiateOAuth = async (req, res) => {
  try {
    const userId = req.user._id.toString();
    
    // Generate state with userId embedded for callback
    const randomState = crypto.randomBytes(32).toString('hex');
    const state = `${randomState}-${userId}`;
    
    // Store state in session as backup
    req.session = req.session || {};
    req.session.oauthState = state;
    req.session.userId = userId;

    const redirectUri = process.env.NYLAS_REDIRECT_URI;
    const authUrl = NylasService.getAuthorizationUrl(redirectUri, state);

    res.json({
      success: true,
      authUrl,
    });
  } catch (error) {
    console.error('OAuth initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate OAuth flow',
    });
  }
};

export const handleOAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code not provided',
      });
    }

    // Decode state to get userId (state contains userId for development)
    let userId;
    try {
      // State is in format: randomhex-userid
      const stateParts = state.split('-');
      if (stateParts.length >= 2) {
        userId = stateParts[stateParts.length - 1];
      }
    } catch (err) {
      console.error('Error parsing state:', err);
    }

    // If we can't get userId from state, try session
    if (!userId && req.session && req.session.userId) {
      userId = req.session.userId;
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Unable to identify user. Please try connecting again.',
      });
    }

    // Exchange code for grant
    const { grantId, email } = await NylasService.exchangeCodeForGrant(code);

    // Update user with grant ID AND connected email
    await User.updateById(userId, {
      nylasGrantId: grantId,
      nylasEmail: email, // Store the actual Nylas-connected email
      emailConnected: true,
      connectedAt: new Date(),
      lastEmailCheck: new Date(), // Start checking from now
    });

    // Clear session
    if (req.session) {
      delete req.session.oauthState;
      delete req.session.userId;
    }

    // Redirect to dashboard
    res.redirect('http://localhost:5173/dashboard?connected=true');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('http://localhost:5173/dashboard?error=connection_failed');
  }
};

export const disconnectEmail = async (req, res) => {
  try {
    const userId = req.user._id.toString();

    await User.updateById(userId, {
      nylasGrantId: null,
      emailConnected: false,
      connectedAt: null,
      lastEmailCheck: null,
    });

    res.json({
      success: true,
      message: 'Email disconnected successfully',
    });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect email',
    });
  }
};

export const getConnectionStatus = async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const user = await User.findById(userId);

    res.json({
      success: true,
      data: {
        connected: user.emailConnected || false,
        connectedAt: user.connectedAt,
        hasGrantId: !!user.nylasGrantId,
        nylasEmail: user.nylasEmail || null, // Return the Nylas-connected email
      },
    });
  } catch (error) {
    console.error('Get connection status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get connection status',
    });
  }
};


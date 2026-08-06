// backend/services/websocketService.js
// WebSocket service for real-time communication with frontend

const WebSocket = require('ws');
const { allowFeatureUpgrade } = require('../middleware/websocketFeatureGuard');
const { getPlatformFeatureSettings } = require('./platformFeatureService');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map to store client connections with metadata
  }

  /**
   * Initialize WebSocket server
   * @param {Object} server - HTTP server instance
   */
  initialize(server) {
    this.wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', async (req, socket, head) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname !== '/ws/assistant') return;
      if (!await allowFeatureUpgrade('aiAssistant', socket)) return;

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      console.log(`🔌 WebSocket client connected: ${clientId}`);

      // Store client with metadata
      this.clients.set(clientId, {
        ws,
        userId: null,
        sessionId: null,
        connected: true,
        connectedAt: new Date()
      });

      // Set up message handling
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(clientId, message);
        } catch (error) {
          console.error('❌ WebSocket message parsing error:', error);
          this.sendError(clientId, 'Invalid message format');
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        console.log(`🔌 WebSocket client disconnected: ${clientId}`);
        this.clients.delete(clientId);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`❌ WebSocket error for client ${clientId}:`, error);
        this.clients.delete(clientId);
      });

      // Send welcome message
      this.sendMessage(clientId, {
        type: 'connection',
        status: 'connected',
        clientId,
        timestamp: new Date().toISOString()
      });
    });

    console.log('🚀 WebSocket service initialized on /ws/assistant');
  }

  /**
   * Handle incoming messages from clients
   * @param {string} clientId - Client identifier
   * @param {Object} message - Parsed message object
   */
  async handleMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const { features } = await getPlatformFeatureSettings();
      if (!features.aiAssistant) {
        this.sendError(clientId, 'AI Assistant is currently unavailable.');
        client.ws.close(1008, 'AI Assistant is unavailable');
        return;
      }
    } catch (error) {
      console.error('Failed to refresh AI Assistant availability:', error);
      this.sendError(clientId, 'AI Assistant availability could not be verified.');
      client.ws.close(1013, 'Feature settings unavailable');
      return;
    }

    console.log(`📨 Received message from ${clientId}:`, message.type);

    switch (message.type) {
      case 'auth':
        await this.handleAuth(clientId, message);
        break;
      
      case 'chat':
        await this.handleChat(clientId, message);
        break;
      
      case 'ping':
        this.sendMessage(clientId, { type: 'pong', timestamp: new Date().toISOString() });
        break;
      
      default:
        this.sendError(clientId, `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle authentication
   * @param {string} clientId - Client identifier
   * @param {Object} message - Auth message
   */
  async handleAuth(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Extract organization from auth token for data isolation
    let organizationId = null;
    if (message.authToken) {
      try {
        const jwt = require('jsonwebtoken');
        const token = message.authToken.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        organizationId = decoded.user.currentOrganization;
        console.log(`🔒 WebSocket organization context extracted: ${organizationId}`);
      } catch (error) {
        console.error('Error extracting organization from WebSocket auth token:', error);
      }
    }

    // Store user info with organization context
    client.userId = message.userId;
    client.sessionId = message.sessionId;
    client.authToken = message.authToken;
    client.organizationId = organizationId;

    console.log(`🔐 Client ${clientId} authenticated as user ${message.userId} in organization ${organizationId}`);

    this.sendMessage(clientId, {
      type: 'auth_success',
      userId: message.userId,
      sessionId: message.sessionId,
      organizationId: organizationId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle chat messages and stream LangChain responses
   * @param {string} clientId - Client identifier
   * @param {Object} message - Chat message
   */
  async handleChat(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { userInput, userId, sessionId, authToken } = message;

    if (!userInput) {
      this.sendError(clientId, 'Missing userInput in chat message');
      return;
    }
    const { streamMessageWithAgent } = require('./langchainAgentService');

    // 🔍 DEBUG: Log session information to track the issue
    console.log(`💬 Processing chat for ${clientId}: "${userInput}"`);
    console.log('🔍 DEBUG - WebSocket handleChat received:');
    console.log('  - message.userId:', userId);
    console.log('  - message.sessionId:', sessionId);
    console.log('  - message.sessionId type:', typeof sessionId);
    console.log('  - message.sessionId length:', sessionId?.length);
    console.log('  - client.userId:', client.userId);
    console.log('  - client.sessionId:', client.sessionId);
    console.log('  - final userId:', userId || client.userId);
    console.log('  - final sessionId:', sessionId || client.sessionId);
    
    // 🚨 CRITICAL: Check if sessionId is changing every time
    if (sessionId && sessionId.includes('chat_')) {
      const timestamp = sessionId.split('_')[1];
      const now = Date.now();
      const sessionAge = now - parseInt(timestamp);
      console.log('🚨 Session Age Analysis:');
      console.log('  - Session timestamp:', timestamp);
      console.log('  - Current timestamp:', now);
      console.log('  - Session age (ms):', sessionAge);
      console.log('  - Session age (seconds):', Math.round(sessionAge / 1000));
      
      if (sessionAge < 5000) { // Less than 5 seconds old
        console.log('🚨 WARNING: Session is very new! This suggests a new session is being created for each message!');
      }
    }

    // Send acknowledgment
    this.sendMessage(clientId, {
      type: 'chat_start',
      userInput,
      timestamp: new Date().toISOString()
    });

    try {
      // Stream the LangChain agent response
      await streamMessageWithAgent(
        userInput,
        userId || client.userId,
        sessionId || client.sessionId,
        authToken || client.authToken,
        {
          onData: (chunk) => {
            // Send thinking process in real-time
            this.sendMessage(clientId, {
              type: 'thinking',
              chunk,
              timestamp: new Date().toISOString()
            });
          },
          onComplete: () => {
            // Send completion signal
            this.sendMessage(clientId, {
              type: 'chat_complete',
              timestamp: new Date().toISOString()
            });
          },
          onError: (error) => {
            // Send error
            this.sendError(clientId, error.message);
          }
        }
      );
    } catch (error) {
      console.error(`❌ Chat processing error for ${clientId}:`, error);
      this.sendError(clientId, 'Failed to process chat message');
    }
  }

  /**
   * Send message to specific client
   * @param {string} clientId - Client identifier
   * @param {Object} message - Message to send
   */
  sendMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client || !client.connected) return;

    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error(`❌ Failed to send message to ${clientId}:`, error);
      this.clients.delete(clientId);
    }
  }

  /**
   * Send error message to client
   * @param {string} clientId - Client identifier
   * @param {string} errorMessage - Error message
   */
  sendError(clientId, errorMessage) {
    this.sendMessage(clientId, {
      type: 'error',
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Broadcast message to all connected clients
   * @param {Object} message - Message to broadcast
   */
  broadcast(message) {
    this.clients.forEach((client, clientId) => {
      this.sendMessage(clientId, message);
    });
  }

  /**
   * Broadcast message to clients within a specific organization
   * @param {Object} message - Message to broadcast
   * @param {string} organizationId - Organization ID to filter by
   */
  broadcastToOrganization(message, organizationId) {
    if (!organizationId) {
      console.warn('⚠️ No organization ID provided for organization broadcast');
      return;
    }

    let sentCount = 0;
    this.clients.forEach((client, clientId) => {
      if (client.organizationId === organizationId) {
        this.sendMessage(clientId, message);
        sentCount++;
      }
    });
    
    console.log(`📡 Broadcasted message to ${sentCount} clients in organization ${organizationId}`);
  }

  /**
   * Generate unique client ID
   * @returns {string} Unique client identifier
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get connection statistics
   * @returns {Object} Connection stats
   */
  getStats() {
    return {
      totalConnections: this.clients.size,
      clients: Array.from(this.clients.entries()).map(([id, client]) => ({
        id,
        userId: client.userId,
        sessionId: client.sessionId,
        connectedAt: client.connectedAt,
        connected: client.connected
      }))
    };
  }

  /**
   * Close all connections and cleanup
   */
  close() {
    if (this.wss) {
      this.clients.forEach((client, clientId) => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close();
        }
      });
      this.clients.clear();
      this.wss.close();
      console.log('🔌 WebSocket service closed');
    }
  }
}

// Export singleton instance
const websocketService = new WebSocketService();
module.exports = websocketService;

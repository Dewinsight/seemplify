/**
 * WebSocket Service for Real-Time Frontend Notifications
 *
 * Enables real-time notifications to frontend when:
 * - User's team membership changes
 * - User needs to re-login (session invalidated)
 * - Team/org updates occur
 */

const WebSocket = require('ws')

// Map of userId -> Set of WebSocket connections
const userConnections = new Map()

// WebSocket server instance
let wss = null

/**
 * Initialize WebSocket server
 * @param {http.Server} server - HTTP server to attach WebSocket to
 */
function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    console.log('🔌 WebSocket connected')

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message)

        // Register user connection
        if (data.type === 'register' && data.userId) {
          if (!userConnections.has(data.userId)) {
            userConnections.set(data.userId, new Set())
          }
          userConnections.get(data.userId).add(ws)
          ws.userId = data.userId
          console.log(`📱 User ${data.userId} registered for notifications`)
        }
      } catch (e) {
        console.error('WebSocket message error:', e)
      }
    })

    ws.on('close', () => {
      // Remove from user connections
      if (ws.userId && userConnections.has(ws.userId)) {
        userConnections.get(ws.userId).delete(ws)
        if (userConnections.get(ws.userId).size === 0) {
          userConnections.delete(ws.userId)
        }
      }
      console.log('🔌 WebSocket disconnected')
    })

    ws.on('error', (error) => {
      console.error('WebSocket error:', error)
    })

    // Send ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping()
      } else {
        clearInterval(pingInterval)
      }
    }, 30000)
  })

  console.log('✅ WebSocket server initialized on /ws')
  return wss
}

/**
 * Notify user via WebSocket that their membership changed
 */
function notifyUser(userId, event, data) {
  const connections = userConnections.get(userId)
  if (!connections || connections.size === 0) {
    console.log(`📭 No WebSocket connections for user ${userId}`)
    return 0
  }

  const message = JSON.stringify({
    type: 'membership_changed',
    event,
    data,
    timestamp: new Date().toISOString(),
  })

  let sent = 0
  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message)
      sent++
      console.log(`📤 Sent notification to user ${userId}: ${event}`)
    }
  }

  return sent
}

/**
 * Notify user they need to re-login
 */
function notifyUserLogout(userId, reason) {
  const connections = userConnections.get(userId)
  if (!connections || connections.size === 0) {
    return 0
  }

  const message = JSON.stringify({
    type: 'force_logout',
    reason,
    timestamp: new Date().toISOString(),
  })

  let sent = 0
  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message)
      sent++
    }
  }

  console.log(`📤 Sent force logout to user ${userId}: ${reason}`)
  return sent
}

/**
 * Broadcast message to all connected users
 */
function broadcast(event, data) {
  if (!wss) return 0

  const message = JSON.stringify({
    type: 'broadcast',
    event,
    data,
    timestamp: new Date().toISOString(),
  })

  let sent = 0
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message)
      sent++
    }
  })

  return sent
}

/**
 * Get count of connected users
 */
function getConnectionCount() {
  return userConnections.size
}

/**
 * Check if user is connected
 */
function isUserConnected(userId) {
  const connections = userConnections.get(userId)
  return connections && connections.size > 0
}

module.exports = {
  initWebSocket,
  notifyUser,
  notifyUserLogout,
  broadcast,
  getConnectionCount,
  isUserConnected,
  userConnections,
}

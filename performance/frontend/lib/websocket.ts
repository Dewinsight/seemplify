import { resolvePerformanceWebSocketUrl } from './runtimeConfig';

/**
 * WebSocket Service for Performance Management Frontend
 * Handles real-time notifications from the backend about membership changes
 */

type MessageHandler = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private userId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private listeners: Map<string, MessageHandler[]> = new Map();
  private reconnectTimeout: NodeJS.Timeout | null = null;

  /**
   * Connect to the WebSocket server
   */
  connect(userId: string) {
    // Don't connect if already connected
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    this.userId = userId;
    const wsUrl = resolvePerformanceWebSocketUrl();
    
    console.log('🔌 Connecting to WebSocket:', wsUrl);
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('✅ WebSocket connected');
        // Register this user with the server
        this.ws?.send(JSON.stringify({ type: 'register', userId }));
        this.reconnectAttempts = 0;
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 WebSocket message received:', data.type);
          this.handleMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      
      this.ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason);
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.attemptReconnect();
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: any) {
    if (data.type === 'force_logout') {
      // User's session has been invalidated by admin or due to membership removal
      alert(data.reason || 'Your session has been invalidated. Please log in again.');
      window.location.href = '/login';
    } else if (data.type === 'membership_changed') {
      // Team/org membership has changed, notify listeners to refresh data
      this.emit('membership_changed', data);
    } else if (data.type === 'claims_updated') {
      // User claims have been updated
      this.emit('claims_updated', data);
    } else if (data.type === 'registered') {
      console.log('✅ Registered with WebSocket server');
    }
  }

  /**
   * Subscribe to an event
   */
  on(event: string, callback: MessageHandler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  /**
   * Unsubscribe from an event
   */
  off(event: string, callback: MessageHandler) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(data);
        } catch (error) {
          console.error(`Error in ${event} callback:`, error);
        }
      });
    }
  }

  /**
   * Attempt to reconnect to WebSocket server
   */
  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Max reconnect attempts reached, giving up');
      return;
    }

    if (!this.userId) {
      console.log('No userId set, cannot reconnect');
      return;
    }

    // Clear any existing timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`🔄 Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(this.userId!);
    }, delay);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    console.log('🔌 Disconnecting WebSocket');
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.userId = null;
    this.reconnectAttempts = 0;
    this.listeners.clear();
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();

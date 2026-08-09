// frontend/hooks/useWebSocket.ts
// React hook for WebSocket communication with backend

import { useEffect, useRef, useState, useCallback } from 'react';
import { getCurrentWsBaseUrl } from '@/services/apiConfig';

export const ASSISTANT_RESPONSE_TIMEOUT_MS = 120_000;

// Get fallback WebSocket URL from JSON config
const getFallbackWsUrl = async (): Promise<string> => {
  try {
    const response = await fetch('/fallback-config.json');
    if (response.ok) {
      const config = await response.json();
      return config.NEXT_PUBLIC_WS_BASE_URL || 'wss://api.seemplifyai.com';
    }
  } catch (error) {
    console.warn('Failed to load fallback config for WebSocket');
  }
  return 'wss://api.seemplifyai.com';
};

export interface WebSocketMessage {
  type: 'connection' | 'thinking' | 'chat_complete' | 'error' | 'auth_success' | 'chat_start' | 'pong' | 'chat' | 'ping';
  chunk?: ThinkingChunk;
  clientId?: string;
  timestamp?: string;
  error?: string;
  userInput?: string;
  userId?: string;
  sessionId?: string;
  organizationId?: string;
  requestId?: string;
  code?: string;
  status?: number;
  details?: Record<string, unknown>;
}

export interface ChatMessage {
  type: 'chat';
  userInput: string;
  userId?: string;
  sessionId?: string;
  authToken?: string;
  organizationId?: string;
  requestId?: string;
}

export interface ThinkingChunk {
  type: 'agent_action' | 'agent_finish' | 'tool' | 'llm' | 'chain_start' | 'chain_end' | 'thinking' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  metadata?: any;
  timestamp?: string;
  status?: string;
  chunk?: any;
  chunkType?: string;
  data?: any;
  event?: string;
  output?: any;
}

export interface WebSocketHookReturn {
  isConnected: boolean;
  isConnecting: boolean;
  sendMessage: (message: WebSocketMessage) => void;
  sendChat: (userInput: string, userId?: string, sessionId?: string, authToken?: string, organizationId?: string) => void;
  lastMessage: WebSocketMessage | null;
  thinkingMessages: ThinkingChunk[];
  finalResult: string | null;
  isProcessing: boolean;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  clearThinking: () => void;
}

const useWebSocket = (url?: string): WebSocketHookReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [thinkingMessages, setThinkingMessages] = useState<ThinkingChunk[]>([]);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  
  // Always use the default/configured WebSocket URL
  const wsUrl = url || `${getCurrentWsBaseUrl()}/ws/assistant`;

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    setIsConnecting(true);
    setError(null);

    // Check if we should use fallback directly (Sterling deployment)
    const shouldUseFallback = typeof window !== 'undefined' && window.location.href.includes('sterling');
    
    const tryConnection = (wsUrl: string) => {
      return new Promise<WebSocket>((resolve, reject) => {
        console.log('🔌 Connecting to WebSocket:', wsUrl);
        const ws = new WebSocket(wsUrl);

        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket connection timeout'));
        }, 5000); // 5 second timeout

        ws.onopen = () => {
          clearTimeout(timeout);
          console.log('✅ WebSocket connected to:', wsUrl);
          resolve(ws);
        };

        ws.onerror = (error) => {
          clearTimeout(timeout);
          console.warn('❌ WebSocket connection failed:', wsUrl, error);
          reject(error);
        };
      });
    };

    if (shouldUseFallback) {
      console.log('🌐 Sterling deployment detected, using fallback WebSocket directly');
      try {
        const fallbackWsUrl = await getFallbackWsUrl();
        wsRef.current = await tryConnection(`${fallbackWsUrl}/ws/assistant`);
      } catch (fallbackError) {
        console.error('❌ Fallback WebSocket failed on Sterling deployment');
        setError('Failed to connect to WebSocket server');
        setIsConnecting(false);
        return;
      }
    } else {
      // Try default URL first, then fallback
      const defaultWsUrl = url || `${getCurrentWsBaseUrl()}/ws/assistant`;
      
      try {
        wsRef.current = await tryConnection(defaultWsUrl);
      } catch (defaultError) {
        console.warn('🔁 Default WebSocket failed, trying fallback...');
        try {
          const fallbackWsUrl = await getFallbackWsUrl();
          wsRef.current = await tryConnection(`${fallbackWsUrl}/ws/assistant`);
        } catch (fallbackError) {
          console.error('❌ Both default and fallback WebSocket failed');
          setError('Failed to connect to WebSocket server');
          setIsConnecting(false);
          return;
        }
      }
    }

    // Set up event handlers for the connected WebSocket
    if (wsRef.current) {
      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('📨 WebSocket message received:', message.type);
          
          setLastMessage(message);
          handleMessage(message);
        } catch (err) {
          console.error('❌ Failed to parse WebSocket message:', err);
          setError('Failed to parse server message');
          setIsProcessing(false);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        setIsConnecting(false);
        setIsProcessing(false);
        
        // Attempt to reconnect if not a manual disconnect
        if (event.code !== 1000 && reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setError('WebSocket connection error');
        setIsConnecting(false);
        setIsProcessing(false);
      };

      setIsConnected(true);
      setIsConnecting(false);
      setError(null);
      reconnectAttempts.current = 0;
    }
  }, [wsUrl, url]); // handleMessage is used in event handlers, not in useCallback dependencies

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setIsConnecting(false);
    reconnectAttempts.current = 0;
  }, []);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('📤 Sending WebSocket message:', message.type);
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('⚠️ WebSocket not connected, cannot send message');
      setError('WebSocket not connected');
      setIsProcessing(false);
    }
  }, []);

  const sendChat = useCallback((userInput: string, userId?: string, sessionId?: string, authToken?: string, organizationId?: string) => {
    // Clear previous state
    setThinkingMessages([]);
    setFinalResult(null);
    setIsProcessing(true);
    setError(null);

    const chatMessage: ChatMessage = {
      type: 'chat',
      userInput,
      userId,
      sessionId,
      authToken,
      organizationId,
      requestId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `assistant-${Date.now()}`
    };

    sendMessage(chatMessage);
  }, [sendMessage]);

  const clearThinking = useCallback(() => {
    setThinkingMessages([]);
    setFinalResult(null);
    setIsProcessing(false);
  }, []);

  const handleMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'connection':
        console.log('🔌 Connection established:', message.clientId);
        break;

      case 'auth_success':
        console.log('🔐 Authentication successful');
        break;

      case 'chat_start':
        console.log('💬 Chat started for:', message.userInput);
        setIsProcessing(true);
        break;

      case 'thinking':
        // Add thinking message to the list
        const thinkingChunk: ThinkingChunk = {
          type: 'thinking',
          chunk: message.chunk,
          chunkType: message.chunk?.data?.chunkType || 
                    (message.chunk?.event === 'on_chain_start' ? 'thinking' : 
                     message.chunk?.event === 'on_chain_end' ? 'final_result' : 
                     message.chunk?.event === 'on_chain_stream' ? 'thinking' : 'thinking'),
          status: message.chunk?.data?.status || 
                 (message.chunk?.data?.output ? 'completed' : 'processing'),
          timestamp: message.timestamp || new Date().toISOString()
        };
        
        console.log('🧠 Adding thinking chunk:', {
          chunkType: thinkingChunk.chunkType,
          status: thinkingChunk.status,
          event: message.chunk?.event,
          rawChunk: message.chunk
        });
        setThinkingMessages(prev => [...prev, thinkingChunk]);
        
        // Check if this is the final result
        if (thinkingChunk.chunkType === 'final_result' || 
            thinkingChunk.status === 'completed' ||
            message.chunk?.data?.output?.output ||
            message.chunk?.event === 'on_chain_end') {
          
          // Try multiple paths to extract the actual result content
          const rawResult = 
            // Job-related responses (formatted by JobAgent)
            message.chunk?.data?.output?.output || 
            message.chunk?.data?.output ||
            // Regular LangChain responses
            message.chunk?.data?.chunk?.output ||
            message.chunk?.output ||
            null; // Don't fallback to a default message
            
          // Only set finalResult if we have meaningful content
          if (rawResult) {
            // Ensure result is always a string
            const result = typeof rawResult === 'string' 
              ? rawResult 
              : JSON.stringify(rawResult);
            
            // Don't set empty objects/arrays as results
            if (result && result !== '{}' && result !== '[]' && result.trim() !== '') {
              console.log('✅ Final result detected:', result);
              setFinalResult(result);
            }
          }
          setIsProcessing(false);
        }
        break;

      case 'chat_complete':
        console.log('✅ Chat completed');
        setIsProcessing(false);
        break;

      case 'error':
        console.error('❌ Server error:', message.error);
        setError(message.error || 'Unknown error');
        setIsProcessing(false);
        break;

      case 'pong':
        // Handle ping/pong for connection health
        break;

      default:
        console.log('📨 Unknown message type:', message.type);
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Ping interval to keep connection alive
  useEffect(() => {
    if (!isConnected) return;

    const pingInterval = setInterval(() => {
      sendMessage({ type: 'ping' });
    }, 30000); // Ping every 30 seconds

    return () => clearInterval(pingInterval);
  }, [isConnected, sendMessage]);

  // A provider or downstream tool can remain connected while never producing a
  // terminal event. Keep the socket alive, but never leave the recruiter locked
  // in an indefinite "thinking" state.
  useEffect(() => {
    if (!isProcessing) return;

    const timeout = setTimeout(() => {
      setError(
        'The assistant did not finish within two minutes. ChatGPT may be busy or out of usage credits. Check AI Account and try again.'
      );
      setIsProcessing(false);
    }, ASSISTANT_RESPONSE_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [isProcessing]);

  return {
    isConnected,
    isConnecting,
    sendMessage,
    sendChat,
    lastMessage,
    thinkingMessages,
    finalResult,
    isProcessing,
    error,
    connect,
    disconnect,
    clearThinking
  };
};

export default useWebSocket; 

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export const useSocket = (userId) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;

    // Create socket connection
    const socketInstance = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
    });

    socketInstance.on('connect', () => {
      console.log('✅ Socket connected');
      setIsConnected(true);
      
      // Join user-specific room
      socketInstance.emit('join', userId);
    });

    socketInstance.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      setIsConnected(false);
    });

    socketInstance.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    setSocket(socketInstance);

    // Cleanup on unmount
    return () => {
      socketInstance.disconnect();
    };
  }, [userId]);

  return { socket, isConnected };
};

export default useSocket;


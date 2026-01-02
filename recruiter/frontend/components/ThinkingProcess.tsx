// frontend/components/ThinkingProcess.tsx
// Component to display AI thinking process in real-time

import React, { useEffect, useState } from 'react';
import { ThinkingChunk } from '../hooks/useWebSocket';

interface ThinkingProcessProps {
  thinkingMessages: ThinkingChunk[];
  isProcessing: boolean;
  className?: string;
}

const ThinkingProcess: React.FC<ThinkingProcessProps> = ({
  thinkingMessages,
  isProcessing,
  className = ''
}) => {
  const [visibleMessages, setVisibleMessages] = useState<ThinkingChunk[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Animate messages appearing one by one
  useEffect(() => {
    if (thinkingMessages.length === 0) {
      setVisibleMessages([]);
      setCurrentIndex(0);
      return;
    }

    const timer = setTimeout(() => {
      if (currentIndex < thinkingMessages.length) {
        setVisibleMessages(prev => [...prev, thinkingMessages[currentIndex]]);
        setCurrentIndex(prev => prev + 1);
      }
    }, 300); // Show each message with 300ms delay

    return () => clearTimeout(timer);
  }, [thinkingMessages, currentIndex]);

  // Reset when new thinking process starts
  useEffect(() => {
    if (thinkingMessages.length === 0) {
      setVisibleMessages([]);
      setCurrentIndex(0);
    }
  }, [thinkingMessages.length]);

  const getStatusIcon = (status?: string, chunkType?: string) => {
    switch (status) {
      case 'processing':
        return '🤔';
      case 'executing':
        return '⚡';
      case 'tool_running':
        return '🔧';
      case 'completed':
        return '✅';
      default:
        return '💭';
    }
  };

  const getStatusText = (status?: string, chunkType?: string) => {
    switch (status) {
      case 'processing':
        return 'Analyzing your request...';
      case 'executing':
        return 'Executing action...';
      case 'tool_running':
        return 'Running tools...';
      case 'completed':
        return 'Processing complete!';
      default:
        return 'Thinking...';
    }
  };

  const formatChunkContent = (chunk: any) => {
    if (chunk?.data?.input) {
      return `Processing: "${chunk.data.input}"`;
    }
    
    if (chunk?.data?.agent) {
      return `Agent: ${chunk.data.agent}`;
    }
    
    if (chunk?.data?.chunk?.agent) {
      return `Using agent: ${chunk.data.chunk.agent}`;
    }
    
    if (chunk?.data?.chunk?.tool) {
      return `Running tool: ${chunk.data.chunk.tool}`;
    }
    
    if (chunk?.event === 'on_chain_start') {
      return 'Starting analysis...';
    }
    
    if (chunk?.event === 'on_chain_stream') {
      return 'Processing stream...';
    }
    
    return 'Processing...';
  };

  if (!isProcessing && thinkingMessages.length === 0) {
    return null;
  }

  return (
    <div className={`thinking-process space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative">
          <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-pulse"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-ping opacity-40"></div>
        </div>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          AI Assistant is thinking...
        </span>
        {isProcessing && (
          <div className="ml-auto">
            <div className="flex space-x-1">
              <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"></div>
              <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce delay-100"></div>
              <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce delay-200"></div>
            </div>
          </div>
        )}
      </div>

      {/* Thinking Messages */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {visibleMessages.map((message, index) => (
          <div
            key={`${message.timestamp}-${index}`}
            className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 animate-fade-in"
          >
            <div className="flex-shrink-0 mt-0.5">
              <div className="text-base">{getStatusIcon(message.status, message.chunkType)}</div>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-gray-600 dark:text-muted-foreground/70 uppercase tracking-wider">
                  {message.chunkType || 'thinking'}
                </span>
                {message.status && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    message.status === 'completed' 
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : message.status === 'processing'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : message.status === 'executing'
                      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-muted-foreground/70'
                  }`}>
                    {message.status}
                  </span>
                )}
              </div>
              
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {getStatusText(message.status, message.chunkType)}
              </div>
              
              {/* Show detailed chunk information */}
              {message.chunk && (
                <div className="mt-2 text-xs text-muted-foreground dark:text-muted-foreground/70">
                  {formatChunkContent(message.chunk)}
                </div>
              )}
              
              {/* Show agent/tool specific information */}
              {message.chunk?.data?.agent && (
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 rounded">
                    🤖 {message.chunk.data.agent}
                  </span>
                </div>
              )}
              
              {message.chunk?.data?.intent && (
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 px-2 py-0.5 rounded">
                    🎯 {message.chunk.data.intent}
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex-shrink-0 text-xs text-muted-foreground/70 dark:text-muted-foreground">
              {new Date(message.timestamp).toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Progress indicator */}
      {isProcessing && thinkingMessages.length > 0 && (
        <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
              Processing step {thinkingMessages.length}...
            </span>
            <div className="w-16 h-1 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-pulse"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThinkingProcess;
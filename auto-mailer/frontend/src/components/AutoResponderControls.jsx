import React from 'react';
import { Bot, Square, CheckCircle, Mail } from 'lucide-react';
import Button from './ui/Button';

const AutoResponderControls = ({ 
  isActive, 
  onStart, 
  onStop, 
  summary 
}) => {
  const { total, processed, responded, skipped } = summary;
  
  if (!isActive) {
    return (
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Bot className="h-5 w-5 text-purple-600 mr-3" />
            <div>
              <h3 className="font-semibold text-purple-900">AI Auto-Responder</h3>
              <p className="text-sm text-purple-700">Automatically respond to unreplied emails using AI</p>
            </div>
          </div>
          <Button
            onClick={onStart}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Bot className="h-4 w-4 mr-2" />
            Start Auto-Responder
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-purple-100 border border-purple-300 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center">
          <div className="animate-pulse">
            <Bot className="h-5 w-5 text-purple-700 mr-3" />
          </div>
          <div>
            <h3 className="font-semibold text-purple-900">Processing Emails...</h3>
            <p className="text-sm text-purple-700">
              {processed} of {total} emails processed
            </p>
          </div>
        </div>
        <Button
          onClick={onStop}
          variant="outline"
          size="sm"
          className="border-purple-400 text-purple-700 hover:bg-purple-200"
        >
          <Square className="h-4 w-4 mr-2" />
          Stop
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-purple-200 rounded-full h-2 overflow-hidden mb-3">
        <div
          className="bg-purple-600 h-2 rounded-full transition-all duration-500"
          style={{ width: `${total > 0 ? (processed / total) * 100 : 0}%` }}
        />
      </div>

      {/* Summary Stats */}
      <div className="flex items-center space-x-6 text-sm">
        <div className="flex items-center text-green-700">
          <CheckCircle className="h-4 w-4 mr-1.5" />
          <span className="font-medium">Responded: {responded}</span>
        </div>
        {skipped > 0 && (
          <div className="flex items-center text-gray-600">
            <Mail className="h-4 w-4 mr-1.5" />
            <span className="font-medium">Skipped: {skipped}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AutoResponderControls;


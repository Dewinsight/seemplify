import React, { useState } from 'react';
import { Bot, Play, AlertCircle, CheckCircle, XCircle, Loader } from 'lucide-react';
import Button from './ui/Button';
import Alert from './ui/Alert';
import aiAPI from '../api/ai';

const AutoResponderPanel = ({ onComplete }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const handleAutoRespond = async () => {
    if (!confirm('This will automatically respond to all unread emails using AI. Continue?')) {
      return;
    }

    try {
      setIsRunning(true);
      setError(null);
      setResults(null);

      const response = await aiAPI.autoRespondAll();

      if (response.success) {
        setResults(response.data);
        if (onComplete) {
          onComplete(response.data);
        }
      }
    } catch (err) {
      console.error('Auto-respond error:', err);
      setError(err.response?.data?.message || 'Failed to auto-respond. Please try again.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-6 border border-purple-200">
      <div className="flex items-start space-x-4">
        <div className="flex-shrink-0">
          <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center">
            <Bot className="h-6 w-6 text-white" />
          </div>
        </div>

        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            AI Auto-Responder
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Automatically respond to all unread emails using Sterling Bank AI assistant. 
            Complex or urgent emails will be flagged for human review.
          </p>

          {error && (
            <Alert
              type="error"
              message={error}
              className="mb-4"
              closable
              onClose={() => setError(null)}
            />
          )}

          {results && (
            <div className="mb-4 bg-white rounded-lg p-4 border border-gray-200">
              <h4 className="font-medium text-gray-900 mb-3">Auto-Response Results:</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-gray-700">
                    <span className="font-semibold">{results.responded}</span> Responded
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm text-gray-700">
                    <span className="font-semibold">{results.escalated}</span> Escalated
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span className="text-sm text-gray-700">
                    <span className="font-semibold">{results.errors}</span> Errors
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Loader className="h-4 w-4 text-blue-600" />
                  <span className="text-sm text-gray-700">
                    <span className="font-semibold">{results.processed}</span> Processed
                  </span>
                </div>
              </div>
            </div>
          )}

          <Button
            variant="primary"
            size="md"
            onClick={handleAutoRespond}
            loading={isRunning}
            disabled={isRunning}
            fullWidth
          >
            <Play className="h-4 w-4 mr-2" />
            {isRunning ? 'Processing...' : 'Auto-Respond to All Unread'}
          </Button>

          <div className="mt-3 flex items-start space-x-2 text-xs text-gray-500">
            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <span>
              Emails marked as complaints, urgent, or containing sensitive keywords will be flagged for human review.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AutoResponderPanel;


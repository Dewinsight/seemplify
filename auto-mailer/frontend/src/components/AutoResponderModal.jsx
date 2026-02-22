import React, { useState } from 'react';
import { X, Bot, CheckCircle, AlertCircle, XCircle, Loader, Play } from 'lucide-react';
import Button from './ui/Button';
import Alert from './ui/Alert';
import aiAPI from '../api/ai';

const AutoResponderModal = ({ isOpen, onClose, onComplete }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [processingEmails, setProcessingEmails] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [error, setError] = useState(null);

  const handleAutoRespond = async () => {
    if (!confirm('This will automatically respond to all unread emails using AI. Continue?')) {
      return;
    }

    try {
      setIsRunning(true);
      setError(null);
      setResults(null);
      setCurrentIndex(0);

      const response = await aiAPI.autoRespondAll();

      if (response.success) {
        setResults(response.data);
        setProcessingEmails(response.data.details || []);
        
        // Animate through results
        if (response.data.details && response.data.details.length > 0) {
          animateResults(response.data.details);
        }
        
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

  const animateResults = async (details) => {
    for (let i = 0; i < details.length; i++) {
      setCurrentIndex(i);
      await new Promise(resolve => setTimeout(resolve, 500)); // Animate each item
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'responded':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'escalated':
        return <AlertCircle className="h-5 w-5 text-yellow-600" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Loader className="h-5 w-5 text-blue-600 animate-spin" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'responded':
        return 'bg-green-50 border-green-200';
      case 'escalated':
        return 'bg-yellow-50 border-yellow-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="absolute inset-y-0 right-0 max-w-md w-full bg-white shadow-xl transform transition-transform">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-600 to-blue-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Bot className="h-6 w-6 text-white mr-3" />
                <h2 className="text-lg font-semibold text-white">AI Auto-Responder</h2>
              </div>
              <button
                onClick={onClose}
                className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-1 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-sm text-gray-600 mb-6">
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

            {/* Results Summary */}
            {results && (
              <div className="mb-6 bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="font-medium text-gray-900 mb-3">Auto-Response Complete!</h3>
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

            {/* Progress Animation */}
            {isRunning && processingEmails.length > 0 && (
              <div className="space-y-2 mb-6">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium text-gray-700">Processing...</span>
                  <span className="text-gray-500">
                    {currentIndex + 1} / {processingEmails.length}
                  </span>
                </div>
                
                {/* Progress bar */}
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-primary-600 h-2 rounded-full transition-all duration-500"
                    style={{ 
                      width: `${((currentIndex + 1) / processingEmails.length) * 100}%` 
                    }}
                  />
                </div>

                {/* Email list with animations */}
                <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
                  {processingEmails.map((email, index) => (
                    <div
                      key={email.messageId}
                      className={`flex items-start space-x-3 p-3 rounded-lg border transition-all duration-300 ${
                        index === currentIndex 
                          ? 'border-primary-500 bg-primary-50 scale-105 shadow-md' 
                          : index < currentIndex
                          ? getStatusColor(email.status)
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {index < currentIndex ? (
                          getStatusIcon(email.status)
                        ) : index === currentIndex ? (
                          <Loader className="h-5 w-5 text-primary-600 animate-spin" />
                        ) : (
                          <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {email.subject}
                        </p>
                        {index < currentIndex && email.status && (
                          <p className="text-xs text-gray-500 mt-0.5 capitalize">
                            {email.status}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Button */}
            {!results && (
              <Button
                variant="primary"
                size="lg"
                onClick={handleAutoRespond}
                loading={isRunning}
                disabled={isRunning}
                fullWidth
              >
                <Play className="h-4 w-4 mr-2" />
                {isRunning ? 'Processing...' : 'Start Auto-Response'}
              </Button>
            )}

            {/* Warning */}
            <div className="mt-4 flex items-start space-x-2 text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
              <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>
                Emails marked as complaints, urgent, or containing sensitive keywords will be flagged for human review.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AutoResponderModal;



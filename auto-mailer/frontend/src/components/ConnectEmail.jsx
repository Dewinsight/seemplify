import React, { useState } from 'react';
import { Mail, ArrowRight, Sparkles } from 'lucide-react';
import Button from './ui/Button';
import nylasAPI from '../api/nylas';

const ConnectEmail = ({ onConnected }) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    try {
      setIsConnecting(true);
      setError(null);

      // Get authorization URL from backend
      const response = await nylasAPI.connectEmail();
      
      if (response.success && response.authUrl) {
        // Redirect to Nylas OAuth page
        window.location.href = response.authUrl;
      } else {
        throw new Error('Failed to get authorization URL');
      }
    } catch (err) {
      console.error('Connect email error:', err);
      setError('Failed to connect email. Please try again.');
      setIsConnecting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          {/* Icon */}
          <div className="mx-auto w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center mb-6">
            <Mail className="h-10 w-10 text-primary-600" />
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Connect Your Email
          </h2>

          {/* Description */}
          <p className="text-gray-600 mb-8">
            Connect your email account to start receiving and responding to messages in real-time.
            We'll only show new emails from your primary inbox.
          </p>

          {/* Error message */}
          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Connect button */}
          <Button
            onClick={handleConnect}
            loading={isConnecting}
            disabled={isConnecting}
            fullWidth
            size="lg"
            className="group"
          >
            <Sparkles className="h-5 w-5 mr-2" />
            <span>{isConnecting ? 'Connecting...' : 'Connect with Nylas'}</span>
            <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
          </Button>

          {/* Features list */}
          <div className="mt-8 space-y-3 text-left">
            <div className="flex items-center text-sm text-gray-600">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
              <span>Real-time email notifications</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
              <span>Quick reply interface</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
              <span>No spam or promotional emails</span>
            </div>
          </div>

          {/* Privacy note */}
          <p className="mt-8 text-xs text-gray-500">
            We only access your primary inbox and never store your email password.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ConnectEmail;


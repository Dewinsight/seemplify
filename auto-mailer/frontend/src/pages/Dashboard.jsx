import React, { useState, useEffect } from 'react';
import { Mail, Send, Settings, LogOut, Sparkles, Inbox, Bot, Megaphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ConnectEmail from '../components/ConnectEmail';
import EmailInbox from '../components/EmailInbox';
import CampaignComposer from '../components/CampaignComposer';
import nylasAPI from '../api/nylas';
import { formatUserName, getUserInitials } from '../utils/auth';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [emailConnected, setEmailConnected] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(true);
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [activeView, setActiveView] = useState('inbox'); // 'inbox' | 'campaigns'
  const [triggerAutoResponder, setTriggerAutoResponder] = useState(false);

  // Check if email is connected on mount
  useEffect(() => {
    checkConnectionStatus();
    
    // Check URL for connection success
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      setEmailConnected(true);
      // Clear the URL parameter
      window.history.replaceState({}, '', '/dashboard');
    }
  }, []);

  const [connectedEmail, setConnectedEmail] = useState(null);

  const checkConnectionStatus = async () => {
    try {
      const response = await nylasAPI.getConnectionStatus();
      if (response.success) {
        setEmailConnected(response.data.connected);
        setConnectedEmail(response.data.nylasEmail || null);
      }
    } catch (err) {
      console.error('Check connection error:', err);
    } finally {
      setIsCheckingConnection(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your email?')) {
      return;
    }

    try {
      await nylasAPI.disconnectEmail();
      setEmailConnected(false);
    } catch (err) {
      console.error('Disconnect error:', err);
      alert('Failed to disconnect email');
    }
  };

  if (isCheckingConnection) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show connect screen if not connected
  if (!emailConnected) {
    return <ConnectEmail onConnected={() => setEmailConnected(true)} />;
  }

  // Show email inbox
  return (
    <div className="h-screen flex bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo/Brand */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center mb-3">
            <div className="bg-primary-100 rounded-lg p-2 mr-3">
              <Sparkles className="h-6 w-6 text-primary-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Auto Mailer</h1>
          </div>
          {connectedEmail && (
            <div className="text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded-lg">
              <div className="font-medium text-gray-900 mb-0.5">Connected Email:</div>
              <div className="truncate">{connectedEmail}</div>
            </div>
          )}
        </div>

        {/* Folder Navigation */}
        <nav className="flex-1 p-4">
          <div className="space-y-1">
            <button
              onClick={() => { setActiveView('inbox'); setActiveFolder('inbox'); }}
              className={`w-full flex items-center px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                activeView === 'inbox' && activeFolder === 'inbox'
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Inbox className="h-5 w-5 mr-3" />
              <span className="flex-1 text-left">Inbox</span>
            </button>

            <button
              onClick={() => { setActiveView('inbox'); setActiveFolder('sent'); }}
              className={`w-full flex items-center px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                activeView === 'inbox' && activeFolder === 'sent'
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Send className="h-5 w-5 mr-3" />
              <span className="flex-1 text-left">Sent</span>
            </button>

            <button
              onClick={() => setActiveView('campaigns')}
              className={`w-full flex items-center px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                activeView === 'campaigns'
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Megaphone className="h-5 w-5 mr-3" />
              <span className="flex-1 text-left">Campaigns</span>
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200 space-y-1">
            <button
              onClick={() => setTriggerAutoResponder(prev => !prev)}
              className="w-full flex items-center px-3 py-2.5 rounded-lg text-purple-700 bg-purple-50 hover:bg-purple-100 font-medium text-sm transition-colors"
            >
              <Bot className="h-5 w-5 mr-3" />
              AI Auto-Responder
            </button>
            
            <button
              onClick={handleDisconnect}
              className="w-full flex items-center px-3 py-2.5 rounded-lg text-gray-700 hover:bg-gray-100 font-medium text-sm transition-colors"
            >
              <Settings className="h-5 w-5 mr-3" />
              Disconnect Email
            </button>
          </div>
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center">
            <div className="bg-primary-600 rounded-full h-10 w-10 flex items-center justify-center text-white font-medium text-sm flex-shrink-0">
              {getUserInitials(user)}
            </div>
            <div className="ml-3 flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {formatUserName(user)}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="p-1 rounded-md hover:bg-gray-100 text-gray-500 transition-colors ml-2"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      {activeView === 'campaigns' ? (
        <CampaignComposer />
      ) : (
        <EmailInbox 
          activeFolder={activeFolder} 
          triggerAutoResponder={triggerAutoResponder}
          onAutoResponderComplete={() => setTriggerAutoResponder(false)}
        />
      )}
    </div>
  );
};

export default Dashboard;

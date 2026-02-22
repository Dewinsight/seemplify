import React, { useState, useEffect } from 'react';
import { Mail, RefreshCw, Inbox as InboxIcon, Send } from 'lucide-react';
import EmailListItem from './EmailListItem';
import EmailDetail from './EmailDetail';
import emailsAPI from '../api/emails';
import aiAPI from '../api/ai';
import useSocket from '../hooks/useSocket';
import { useAuth } from '../contexts/AuthContext';
import AutoResponderControls from './AutoResponderControls';

const EmailInbox = ({ activeFolder = 'inbox', triggerAutoResponder = false, onAutoResponderComplete }) => {
  const { user } = useAuth();
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  
  // Auto-responder state
  const [isAutoResponding, setIsAutoResponding] = useState(false);
  const [processingStates, setProcessingStates] = useState({});
  const [currentProcessingId, setCurrentProcessingId] = useState(null);
  const [processingSummary, setProcessingSummary] = useState({ total: 0, processed: 0, responded: 0, skipped: 0 });
  
  // Socket.io for real-time updates
  const { socket, isConnected } = useSocket(user?._id);

  // Fetch emails on mount and when folder changes
  useEffect(() => {
    fetchEmails();
    if (activeFolder === 'inbox') {
      fetchUnreadCount();
    }
  }, [activeFolder]);

  // Listen for new emails via Socket.io
  useEffect(() => {
    if (!socket) return;

    socket.on('new-email', (data) => {
      console.log('📧 New email received:', data.email);
      
      // Only add to list if we're on inbox folder
      if (activeFolder === 'inbox') {
        setEmails(prev => [data.email, ...prev]);
        setUnreadCount(prev => prev + 1);
      }
      
      // Show browser notification if permitted
      if (Notification.permission === 'granted') {
        new Notification('New Email', {
          body: `From: ${data.email.from?.name || data.email.from?.email}\n${data.email.subject}`,
          icon: '/vite.svg',
        });
      }
    });

    return () => {
      socket.off('new-email');
    };
  }, [socket, activeFolder]);

  const fetchEmails = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await emailsAPI.getEmails(50, activeFolder);
      
      if (response.success) {
        setEmails(response.data.emails);
      }
    } catch (err) {
      console.error('Fetch emails error:', err);
      setError('Failed to load emails');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const response = await emailsAPI.getUnreadCount();
      if (response.success) {
        setUnreadCount(response.data.unreadCount);
      }
    } catch (err) {
      console.error('Fetch unread count error:', err);
    }
  };

  const handleEmailClick = async (email) => {
    setSelectedEmail(email);
    
    // Mark as read if unread
    if (!email.isRead && activeFolder === 'inbox') {
      try {
        await emailsAPI.getEmailById(email.messageId);
        
        // Update local state
        setEmails(prev => prev.map(e => 
          e.messageId === email.messageId ? { ...e, isRead: true } : e
        ));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (err) {
        console.error('Mark as read error:', err);
      }
    }
  };

  const handleReplySent = () => {
    // Update the email as replied
    if (selectedEmail) {
      setEmails(prev => prev.map(e =>
        e.messageId === selectedEmail.messageId ? { ...e, hasReplied: true } : e
      ));
      setSelectedEmail(prev => ({ ...prev, hasReplied: true }));
    }
    
    // Refresh emails to show the sent reply
    fetchEmails();
  };

  // Auto-Responder: Sequential processing logic
  const handleAutoRespond = async () => {
    if (!confirm('Start AI Auto-Responder? This will process all unreplied emails.')) {
      return;
    }

    // Get unreplied emails from inbox (regardless of read status)
    const unresponded = emails.filter(e => !e.hasReplied && activeFolder === 'inbox');
    
    if (unresponded.length === 0) {
      alert('No unreplied emails to respond to!');
      return;
    }

    setIsAutoResponding(true);
    setProcessingSummary({ total: unresponded.length, processed: 0, responded: 0, skipped: 0 });
    
    for (let i = 0; i < unresponded.length; i++) {
      const email = unresponded[i];
      setCurrentProcessingId(email.messageId);
      
      try {
        // Step 1: Processing
        setProcessingStates(prev => ({ ...prev, [email.messageId]: 'processing' }));
        await new Promise(r => setTimeout(r, 300)); // Visual feedback delay
        
        // Step 2: Generating AI response
        setProcessingStates(prev => ({ ...prev, [email.messageId]: 'generating' }));
        const aiResponse = await aiAPI.generateResponse(email.messageId);
        
        // Step 3: Check if marketing/automated email
        if (aiResponse.data?.isMarketing) {
          console.log(`📧 Skipping marketing email: ${email.subject}`);
          setProcessingStates(prev => ({ ...prev, [email.messageId]: 'skipped' }));
          setProcessingSummary(prev => ({ 
            ...prev, 
            processed: i + 1,
            skipped: (prev.skipped || 0) + 1
          }));
          await new Promise(r => setTimeout(r, 300)); // Brief pause
          continue; // Move to next email without responding
        }
        
        // Step 4: Auto-send to genuine customer inquiries
        if (aiResponse.data?.suggestedResponse) {
          await emailsAPI.sendReply(email.messageId, aiResponse.data.suggestedResponse);
          setProcessingStates(prev => ({ ...prev, [email.messageId]: 'sent' }));
          setProcessingSummary(prev => ({ 
            ...prev, 
            processed: i + 1, 
            responded: prev.responded + 1 
          }));
          
          // Update local email state
          setEmails(prevEmails => prevEmails.map(e =>
            e.messageId === email.messageId ? { ...e, hasReplied: true, isRead: true } : e
          ));
        } else {
          // No response generated - count as processed
          setProcessingSummary(prev => ({ 
            ...prev, 
            processed: i + 1 
          }));
        }
        
        await new Promise(r => setTimeout(r, 500)); // Visual feedback delay
      } catch (error) {
        console.error('Error processing email:', email.messageId, error);
        // On error, just count as processed without response
        setProcessingSummary(prev => ({ 
          ...prev, 
          processed: i + 1 
        }));
      }
    }
    
    setIsAutoResponding(false);
    setCurrentProcessingId(null);
    
    if (onAutoResponderComplete) {
      onAutoResponderComplete();
    }

    // Refresh emails after completion
    await fetchEmails();
    await fetchUnreadCount();
  };

  const handleStopAutoResponder = () => {
    setIsAutoResponding(false);
    setCurrentProcessingId(null);
    setProcessingStates({});
    if (onAutoResponderComplete) {
      onAutoResponderComplete();
    }
  };

  // Watch for trigger from Dashboard
  useEffect(() => {
    if (triggerAutoResponder && !isAutoResponding && activeFolder === 'inbox') {
      handleAutoRespond();
    }
  }, [triggerAutoResponder]);

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const getFolderIcon = () => {
    return activeFolder === 'sent' ? Send : InboxIcon;
  };

  const getFolderTitle = () => {
    return activeFolder === 'sent' ? 'Sent' : 'Inbox';
  };

  if (isLoading && emails.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 text-primary-600 animate-spin mx-auto mb-2" />
          <p className="text-gray-600">Loading emails...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchEmails}
            className="text-primary-600 hover:text-primary-700 font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const FolderIcon = getFolderIcon();

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      {/* Email list - Hidden when email is selected */}
      <div className={`w-full flex flex-col bg-white min-h-0 ${selectedEmail ? 'hidden' : ''}`}>
        {/* List header */}
        <div className="p-4 border-b border-gray-200 bg-white flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <FolderIcon className="h-5 w-5 text-gray-600 mr-2" />
              <h2 className="text-lg font-semibold text-gray-900">
                {getFolderTitle()}
                {activeFolder === 'inbox' && unreadCount > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs bg-primary-600 text-white rounded-full">
                    {unreadCount}
                  </span>
                )}
              </h2>
            </div>
            <button
              onClick={fetchEmails}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 text-gray-600 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          
          {activeFolder === 'inbox' && isConnected && (
            <p className="text-xs text-green-600 flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
              Live updates active
            </p>
          )}
        </div>

        {/* Auto-Responder Controls - Only show in inbox */}
        {activeFolder === 'inbox' && (
          <div className="p-4 bg-white">
            <AutoResponderControls
              isActive={isAutoResponding}
              onStart={handleAutoRespond}
              onStop={handleStopAutoResponder}
              summary={processingSummary}
            />
          </div>
        )}

        {/* Email list */}
        <div className="flex-1 overflow-y-auto">
          {emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <FolderIcon className="h-16 w-16 text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {activeFolder === 'sent' ? 'No sent emails' : 'No emails yet'}
              </h3>
              <p className="text-sm text-gray-500">
                {activeFolder === 'sent' 
                  ? 'Emails you send will appear here' 
                  : 'New emails will appear here as they arrive'}
              </p>
            </div>
          ) : (
            emails.map((email) => (
              <EmailListItem
                key={email._id || email.messageId}
                email={email}
                isSelected={selectedEmail?.messageId === email.messageId}
                onClick={handleEmailClick}
                isSentFolder={activeFolder === 'sent'}
                processingState={processingStates[email.messageId] || null}
              />
            ))
          )}
        </div>
      </div>

      {/* Email detail - Full width when shown */}
      {selectedEmail && (
      <EmailDetail
        email={selectedEmail}
        onBack={() => setSelectedEmail(null)}
        onReplySent={handleReplySent}
        isSentFolder={activeFolder === 'sent'}
      />
      )}
    </div>
  );
};

export default EmailInbox;

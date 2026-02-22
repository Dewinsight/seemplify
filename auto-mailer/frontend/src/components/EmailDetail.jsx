import React, { useState, useEffect } from 'react';
import moment from 'moment';
import { ArrowLeft, Reply, ReplyAll, Forward, Mail, User, Users, Paperclip, ChevronDown, ChevronUp } from 'lucide-react';
import Button from './ui/Button';
import QuickReply from './QuickReply';
import emailsAPI from '../api/emails';

const EmailDetail = ({ email, onBack, onReplySent, isSentFolder = false }) => {
  const [showReply, setShowReply] = useState(false);
  const [showFullHeaders, setShowFullHeaders] = useState(false);
  const [threadEmails, setThreadEmails] = useState([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState(new Set());

  const getInitials = (text) => {
    if (!text) return '?';
    return text
      .split(' ')
      .map(n => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  // Load thread if this email has a threadId
  useEffect(() => {
    if (email && email.threadId) {
      loadThread(email.threadId);
    } else {
      setThreadEmails([]);
    }
  }, [email?.messageId]);

  const loadThread = async (threadId) => {
    try {
      setIsLoadingThread(true);
      const response = await emailsAPI.getThread(threadId);
      
      if (response.success) {
        setThreadEmails(response.data.thread);
        // Expand only the latest (current) email
        if (response.data.thread.length > 0) {
          const latestId = response.data.thread[response.data.thread.length - 1].messageId;
          setExpandedEmails(new Set([latestId]));
        }
      }
    } catch (err) {
      console.error('Load thread error:', err);
      setThreadEmails([]);
    } finally {
      setIsLoadingThread(false);
    }
  };

  const toggleEmailExpansion = (messageId) => {
    setExpandedEmails(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Mail className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Select an email to view</p>
        </div>
      </div>
    );
  }

  const handleReplySuccess = () => {
    setShowReply(false);
    if (onReplySent) {
      onReplySent();
    }
  };

  const hasMultipleRecipients = email.to && email.to.length > 1;
  const hasCC = email.cc && email.cc.length > 0;

  // Use thread emails if available, otherwise just show current email
  const emailsToDisplay = threadEmails.length > 0 ? threadEmails : [email];
  const threadCount = emailsToDisplay.length;

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden min-h-0">
      {/* Header */}
      <div className="border-b border-gray-200 p-4 bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Inbox
          </Button>
          
          {!isSentFolder && !showReply && (
            <div className="ml-auto flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowReply(true)}
              >
                <Reply className="h-4 w-4 mr-2" />
                Reply
              </Button>
              
              {(hasMultipleRecipients || hasCC) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReply(true)}
                >
                  <ReplyAll className="h-4 w-4 mr-2" />
                  Reply All
                </Button>
              )}
              
              <Button
                variant="outline"
                size="sm"
              >
                <Forward className="h-4 w-4 mr-2" />
                Forward
              </Button>
            </div>
          )}
        </div>

        {/* Subject */}
        <h2 className="text-xl font-semibold text-gray-900 mb-3">
          {email.subject || '(No Subject)'}
          {threadCount > 1 && (
            <span className="ml-3 text-sm font-normal text-gray-500">
              {threadCount} messages
            </span>
          )}
        </h2>
      </div>

      {/* Email body/thread */}
      <div className="flex-1 overflow-y-auto">
        {emailsToDisplay.map((threadEmail, index) => {
          const isExpanded = expandedEmails.has(threadEmail.messageId);
          const isLatest = index === emailsToDisplay.length - 1;
          const displayPerson = isSentFolder
            ? (threadEmail.to && threadEmail.to.length > 0 ? threadEmail.to[0] : { name: '', email: '' })
            : threadEmail.from;

          return (
            <div
              key={threadEmail.messageId}
              className={`border-b border-gray-100 ${isLatest ? '' : 'bg-gray-50'}`}
            >
              {/* Email header (collapsible for thread) */}
              <div
                className={`p-6 ${threadCount > 1 && !isLatest ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                onClick={() => threadCount > 1 && !isLatest && toggleEmailExpansion(threadEmail.messageId)}
              >
                <div className="flex items-start space-x-3">
                  {/* Sender avatar */}
                  <div className="w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-medium flex-shrink-0">
                    {getInitials(displayPerson?.name || displayPerson?.email)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {displayPerson?.name || displayPerson?.email}
                        </p>
                        {showFullHeaders || isExpanded ? (
                          <div className="text-xs text-gray-600 space-y-0.5 mt-1">
                            <p>
                              <span className="font-medium">From:</span> {threadEmail.from?.email}
                            </p>
                            <p>
                              <span className="font-medium">To:</span>{' '}
                              {threadEmail.to?.map(t => t.email).join(', ')}
                            </p>
                            {threadEmail.cc && threadEmail.cc.length > 0 && (
                              <p>
                                <span className="font-medium">Cc:</span>{' '}
                                {threadEmail.cc.map(c => c.email).join(', ')}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">
                            {isSentFolder ? 'to' : 'to me'}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {moment(threadEmail.receivedAt).format('MMM D, YYYY [at] h:mm A')}
                        </span>
                        {threadCount > 1 && !isLatest && (
                          isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                    </div>

                    {threadEmail.attachments && threadEmail.attachments.length > 0 && isExpanded && (
                      <div className="mt-2 flex items-center space-x-2">
                        <Paperclip className="h-4 w-4 text-gray-400" />
                        <span className="text-xs text-gray-600">
                          {threadEmail.attachments.length} attachment{threadEmail.attachments.length > 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Email body (shown only if expanded or latest) */}
                {(isExpanded || isLatest) && (
                  <div className="mt-4 pl-13">
                    {threadEmail.body && threadEmail.body.trim().length > 0 ? (
                      <div 
                        className="email-content text-sm text-gray-700"
                        style={{
                          lineHeight: '1.6',
                          whiteSpace: 'normal'
                        }}
                        dangerouslySetInnerHTML={{ __html: threadEmail.body }}
                      />
                    ) : threadEmail.snippet ? (
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">
                        {threadEmail.snippet}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">
                        Email body not available
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply section */}
      {showReply && !isSentFolder && (
        <div className="border-t border-gray-200 bg-white flex-shrink-0">
          <QuickReply
            email={email}
            onCancel={() => setShowReply(false)}
            onSuccess={handleReplySuccess}
          />
        </div>
      )}
    </div>
  );
};

export default EmailDetail;

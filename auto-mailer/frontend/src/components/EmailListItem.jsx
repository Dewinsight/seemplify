import React from 'react';
import moment from 'moment';
import { Mail, MailOpen, Paperclip, Users } from 'lucide-react';

const EmailListItem = ({ email, isSelected, onClick, isSentFolder = false, processingState = null }) => {
  const getInitials = (name) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map(n => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const formatTime = (date) => {
    const messageDate = moment(date);
    const now = moment();
    
    if (now.diff(messageDate, 'minutes') < 60) {
      return messageDate.fromNow(); // "2 minutes ago"
    } else if (now.diff(messageDate, 'hours') < 24) {
      return messageDate.format('h:mm A'); // "2:30 PM"
    } else if (now.diff(messageDate, 'days') < 2) {
      return 'Yesterday';
    } else if (now.diff(messageDate, 'days') < 7) {
      return messageDate.format('ddd'); // "Mon"
    } else {
      return messageDate.format('MMM D'); // "Jan 5"
    }
  };

  // For sent emails, show recipient; for inbox, show sender
  const displayContact = isSentFolder
    ? (email.to && email.to.length > 0 ? email.to[0] : { name: '', email: '' })
    : email.from;

  const hasAttachments = email.attachments && email.attachments.length > 0;
  const hasMultipleRecipients = email.to && email.to.length > 1;

  // Determine background and border based on processing state
  const getProcessingStyles = () => {
    if (processingState === 'processing') return 'bg-blue-50 border-l-4 border-l-blue-500 animate-pulse';
    if (processingState === 'generating') return 'bg-purple-50 border-l-4 border-l-purple-500';
    if (processingState === 'sent') return 'bg-green-50 border-l-4 border-l-green-500';
    if (processingState === 'skipped') return 'bg-gray-50 border-l-4 border-l-gray-400';
    return '';
  };

  return (
    <div
      onClick={() => onClick(email)}
      className={`relative p-4 border-b border-gray-200 cursor-pointer transition-all hover:bg-gray-50 ${
        isSelected ? 'bg-primary-50 border-l-4 border-l-primary-600' : ''
      } ${!email.isRead && !isSentFolder && !processingState ? 'bg-blue-50' : ''} ${getProcessingStyles()}`}
    >
      <div className="flex items-start space-x-3">
        {/* Avatar */}
        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
          !email.isRead && !isSentFolder ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'
        }`}>
          {getInitials(displayContact?.name || displayContact?.email)}
        </div>

        {/* Email content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center flex-1 min-w-0">
              <h4 className={`text-sm truncate ${!email.isRead && !isSentFolder ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                {isSentFolder ? 'To: ' : ''}
                {displayContact?.name || displayContact?.email}
              </h4>
              {hasMultipleRecipients && isSentFolder && (
                <Users className="h-3 w-3 text-gray-400 ml-1 flex-shrink-0" title="Multiple recipients" />
              )}
            </div>
            <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
              {formatTime(email.receivedAt)}
            </span>
          </div>

          <p className={`text-sm mb-1 truncate ${!email.isRead && !isSentFolder ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
            {email.subject || '(No Subject)'}
          </p>

          <p className="text-xs text-gray-500 truncate line-clamp-2">
            {email.snippet || 'No preview available'}
          </p>

          {/* Status indicators */}
          <div className="flex items-center mt-2 space-x-2">
            {!email.isRead && !isSentFolder && (
              <span className="flex items-center text-xs text-primary-600 font-medium">
                <span className="w-2 h-2 bg-primary-600 rounded-full mr-1.5"></span>
                Unread
              </span>
            )}
            {email.hasReplied && !isSentFolder && (
              <span className="text-xs text-green-600 font-medium">
                ↩ Replied
              </span>
            )}
            {hasAttachments && (
              <span className="flex items-center text-xs text-gray-500">
                <Paperclip className="h-3 w-3 mr-1" />
                {email.attachments.length}
              </span>
            )}
          </div>
        </div>

        {/* Unread icon */}
        {!email.isRead && !isSentFolder && !processingState && (
          <div className="flex-shrink-0">
            <div className="w-2 h-2 bg-primary-600 rounded-full"></div>
          </div>
        )}
      </div>

      {/* Processing State Badge */}
      {processingState && (
        <div className={`absolute top-2 right-2 text-xs px-2.5 py-1 rounded-full font-medium flex items-center space-x-1 shadow-sm slide-in-badge ${
          processingState === 'processing' ? 'bg-blue-100 text-blue-700 border border-blue-300 animate-pulse' :
          processingState === 'generating' ? 'bg-purple-100 text-purple-700 border border-purple-300 animate-pulse' :
          processingState === 'sent' ? 'bg-green-100 text-green-700 border border-green-300' :
          processingState === 'skipped' ? 'bg-gray-100 text-gray-600 border border-gray-300' :
          'bg-gray-100 text-gray-600 border border-gray-300'
        }`}>
          <span>
            {processingState === 'processing' ? '⏳ Processing' :
             processingState === 'generating' ? '🤖 Generating' :
             processingState === 'sent' ? '✓ Responded' :
             processingState === 'skipped' ? '📧 Marketing' :
             '•'}
          </span>
        </div>
      )}
    </div>
  );
};

export default EmailListItem;

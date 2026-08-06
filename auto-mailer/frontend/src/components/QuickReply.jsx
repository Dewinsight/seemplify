import React, { useState } from 'react';
import { Send, X, Sparkles, RefreshCw } from 'lucide-react';
import Button from './ui/Button';
import emailsAPI from '../api/emails';
import aiAPI from '../api/ai';
import Alert from './ui/Alert';

const QuickReply = ({ email, onCancel, onSuccess }) => {
  const [replyBody, setReplyBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [aiWarning, setAiWarning] = useState(null);

  const handleAISuggest = async () => {
    try {
      setIsGenerating(true);
      setError(null);
      setAiWarning(null);

      const response = await aiAPI.generateResponse(email.messageId);

      if (response.success) {
        setReplyBody(response.data.suggestedResponse);
        
        if (response.data.needsEscalation) {
          setAiWarning(response.data.warning || 'This email may require human review.');
        }
      }
    } catch (err) {
      console.error('AI suggest error:', err);
      setError(err.response?.data?.message || 'Failed to generate AI response. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!replyBody.trim()) {
      setError('Please enter a reply message');
      return;
    }

    try {
      setIsSending(true);
      setError(null);

      await emailsAPI.sendReply(email.messageId, replyBody);

      // Success!
      setReplyBody('');
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Send reply error:', err);
      setError(err.response?.data?.message || 'Failed to send reply. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="border-t border-gray-200 bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-900">Quick Reply</h3>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <Alert
            type="error"
            message={error}
            className="mb-3"
            closable
            onClose={() => setError(null)}
          />
        )}

        {aiWarning && (
          <Alert
            type="warning"
            message={aiWarning}
            className="mb-3"
            closable
            onClose={() => setAiWarning(null)}
          />
        )}

        {/* AI Suggest Button */}
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Replying to: <span className="font-medium">{email.from?.name || email.from?.email}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAISuggest}
            loading={isGenerating}
            disabled={isGenerating || isSending}
          >
            <Sparkles className="h-3 w-3 mr-1.5" />
            {isGenerating ? 'Generating...' : 'AI Suggest'}
          </Button>
        </div>

        {/* Reply textarea */}
        <textarea
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          placeholder="Type your reply here..."
          rows={6}
          disabled={isSending}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
        />

        {/* Action buttons */}
        <div className="flex items-center justify-end space-x-2 mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            loading={isSending}
            disabled={isSending || !replyBody.trim()}
          >
            <Send className="h-4 w-4 mr-2" />
            {isSending ? 'Sending...' : 'Send Reply'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default QuickReply;


import apiClient from './client';

export const emailsAPI = {
  // Get all emails (with optional folder filter)
  getEmails: async (limit = 50, folder = null) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (folder) {
      params.append('folder', folder);
    }
    const response = await apiClient.get(`/api/emails?${params.toString()}`);
    return response.data;
  },

  // Get single email by messageId
  getEmailById: async (messageId) => {
    const response = await apiClient.get(`/api/emails/${messageId}`);
    return response.data;
  },

  // Get email thread
  getThread: async (threadId) => {
    const response = await apiClient.get(`/api/emails/thread/${threadId}`);
    return response.data;
  },

  // Send reply to an email
  sendReply: async (messageId, replyBody) => {
    const response = await apiClient.post(`/api/emails/${messageId}/reply`, {
      body: replyBody,
    });
    return response.data;
  },

  // Get unread count
  getUnreadCount: async () => {
    const response = await apiClient.get('/api/emails/unread-count');
    return response.data;
  },

  // Get unreplied count
  getUnrepliedCount: async () => {
    const response = await apiClient.get('/api/emails/unreplied-count');
    return response.data;
  },
};

export default emailsAPI;


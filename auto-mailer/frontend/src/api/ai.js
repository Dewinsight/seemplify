import apiClient from './client';

export const aiAPI = {
  // Generate AI response for an email
  generateResponse: async (messageId) => {
    const response = await apiClient.post(`/api/ai/generate-response/${messageId}`);
    return response.data;
  },

  // Auto-respond to all unread emails
  autoRespondAll: async () => {
    const response = await apiClient.post('/api/ai/auto-respond-all');
    return response.data;
  },

  // Analyze email intent
  analyzeIntent: async (messageId) => {
    const response = await apiClient.post(`/api/ai/analyze-intent/${messageId}`);
    return response.data;
  },

  // Get knowledge base
  getKnowledgeBase: async () => {
    const response = await apiClient.get('/api/ai/knowledge-base');
    return response.data;
  },
};

export default aiAPI;


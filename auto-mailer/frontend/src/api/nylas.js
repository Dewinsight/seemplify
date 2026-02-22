import apiClient from './client';

export const nylasAPI = {
  // Get authorization URL to connect email
  connectEmail: async () => {
    const response = await apiClient.get('/api/nylas/connect');
    return response.data;
  },

  // Check connection status
  getConnectionStatus: async () => {
    const response = await apiClient.get('/api/nylas/status');
    return response.data;
  },

  // Disconnect email account
  disconnectEmail: async () => {
    const response = await apiClient.post('/api/nylas/disconnect');
    return response.data;
  },
};

export default nylasAPI;


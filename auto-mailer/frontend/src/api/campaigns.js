import apiClient from './client';

export const campaignsAPI = {
  parseCsv: async (csvContent) => {
    const response = await apiClient.post('/api/campaigns/parse-csv', {
      csvContent,
    });
    return response.data;
  },

  sendCampaign: async ({ recipients, subjectTemplate, bodyTemplate, emailField, nameField }) => {
    // Long timeout: batches of 5 with 20-60s delays can take several minutes
    const response = await apiClient.post(
      '/api/campaigns/send',
      {
        recipients,
        subjectTemplate,
        bodyTemplate,
        emailField: emailField || 'email',
        nameField: nameField || 'name',
      },
      { timeout: 600000 }
    ); // 10 min
    return response.data;
  },
};

export default campaignsAPI;

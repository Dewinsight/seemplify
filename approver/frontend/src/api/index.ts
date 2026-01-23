import axios from 'axios';

// Use VITE_API_BASE_URL from build-time env var, or fallback
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.PROD 
    ? 'https://api.approver.aiinigeria.com/api' 
    : 'http://localhost:5000/api');

const api = axios.create({
    baseURL: apiBaseUrl,
});

export default api;

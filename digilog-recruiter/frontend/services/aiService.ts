import { apiRequest, getAuthHeaders } from './apiConfig';

interface JobAIData {
  title: string;
  department: string;
  level?: string;
  location?: string;
  type?: string;
  experience?: string;
  education?: string;
}

interface JobDescriptionResponse {
  msg: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
  benefits: string[];
}

interface JobRequirementsResponse {
  msg: string;
  requirements: string;
}



// Generate job description using AI
export const generateJobDescription = async (jobData: JobAIData): Promise<JobDescriptionResponse> => {
  try {
    console.log('🤖 Attempting to generate job description for:', jobData);
    console.log('🔑 Auth headers:', getAuthHeaders());
    
    const response = await apiRequest(`/api/ai/generate-job-description`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(jobData),
    });

    console.log('📡 Response status:', response.status);
    console.log('📡 Response headers:', response.headers);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      console.error('❌ API Error:', errorData);
      
      if (response.status === 401) {
        throw new Error('Authentication required. Please log in to use AI features.');
      } else if (response.status === 500) {
        throw new Error('AI service temporarily unavailable. Please try again in a moment.');
      }
      
      throw new Error(errorData.msg || errorData.error || `Request failed with status ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Job description generated successfully');
    return result;
  } catch (error: any) {
    console.error('❌ Error generating job description:', error);
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network connection error. Please check your internet connection.');
    }
    
    throw new Error(error.message || 'An unexpected error occurred while generating the job description');
  }
};

// Generate job requirements using AI
export const generateJobRequirements = async (jobData: JobAIData): Promise<JobRequirementsResponse> => {
  try {
    console.log('🤖 Attempting to generate job requirements for:', jobData);
    console.log('🔑 Auth headers:', getAuthHeaders());
    
    const response = await apiRequest(`/api/ai/generate-job-requirements`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(jobData),
    });

    console.log('📡 Response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      console.error('❌ API Error:', errorData);
      
      if (response.status === 401) {
        throw new Error('Authentication required. Please log in to use AI features.');
      } else if (response.status === 500) {
        throw new Error('AI service temporarily unavailable. Please try again in a moment.');
      }
      
      throw new Error(errorData.msg || errorData.error || `Request failed with status ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Job requirements generated successfully');
    return result;
  } catch (error: any) {
    console.error('❌ Error generating job requirements:', error);
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network connection error. Please check your internet connection.');
    }
    
    throw new Error(error.message || 'An unexpected error occurred while generating the job requirements');
  }
};



// Test Azure OpenAI connection
export const testAIConnection = async (): Promise<{ msg: string; response?: string; error?: string }> => {
  try {
    const response = await apiRequest(`/api/ai/test-connection`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    return await response.json();
  } catch (error: any) {
    console.error('Error testing AI connection:', error);
    throw new Error(error.message || 'Network error occurred');
  }
};

export type { JobAIData, JobDescriptionResponse, JobRequirementsResponse }; 
import { apiRequest, getAuthHeaders, getCurrentApiBaseUrl } from './apiConfig';

// Message types
export type MessageType = "user" | "assistant" | "system"

export interface AssistantMessage {
  id: string
  type: MessageType
  content: string
  timestamp: Date
  attachments?: {
    name: string
    type: string
    size: number
    url: string
    data?: string // Base64 data for files
  }[]
  isLoading?: boolean
  actions?: {
    label: string
    icon?: string
    action: string
    data?: any
  }[]
  metadata?: {
    candidateId?: string
    jobId?: string
    confidence?: number
    processingTime?: number
    intent?: string
    dataUsed?: string
    agentSteps?: any[] // Added for streaming agent steps
  }
  // Job form properties
  isJobForm?: boolean
  jobFormData?: any
  // Guide data for tutorial-based responses
  guideData?: {
    type: string
    intent: string
    title: string
    introduction: string
    steps: Array<{
      number: number
      title: string
      description: string
      tip?: string
    }>
    navigationCard: {
      title: string
      description: string
      primaryButton: {
        label: string
        url: string
        icon: string
      }
      secondaryButton?: {
        label: string
        url: string
        icon: string
      }
    }
    tips?: string[]
    relatedFeatures?: Array<{
      name: string
      url: string
      description: string
    }>
    commonTopics?: Array<{
      title: string
      examples: string[]
    }>
  }
}

export interface ChatResponse {
  message: string
  actions?: Array<{
    label: string
    icon?: string
    action: string
    data?: any
  }>
  metadata?: {
    confidence?: number
    processingTime?: number
    extractedData?: any
    intent?: string
    dataUsed?: string
    conversationHistory?: {
      hasHistory: boolean
      userTotalInteractions: number
    }
  }
}

export interface FileAnalysisResult {
  success: boolean
  type: 'resume' | 'job_description' | 'document' | 'unknown'
  extractedData?: any
  message: string
  actions?: Array<{
    label: string
    icon?: string
    action: string
    data?: any
  }>
}

class AssistantService {
  constructor() {
    // No session management needed - purely JWT-based
  }


  /**
   * Send a message to the AI assistant
   */
  async sendMessage(message: string, context?: any, chatSessionId?: string): Promise<ChatResponse> {
    try {
      const response = await apiRequest(`/api/ai/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
        body: JSON.stringify({
          message,
          context,
          chatSessionId,
          timestamp: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to send message');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error sending message:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get chat history for the current user
   */
  async getChatHistory(limit: number = 20): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/chat-history?limit=${limit}`, {
        method: 'GET',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get chat history');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting chat history:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Clear chat history for the current session
   */
  async clearChatHistory(): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/chat-history/clear`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to clear chat history');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error clearing chat history:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Search chat history
   */
  async searchChatHistory(query: string, limit: number = 10): Promise<any> {
    try {
      const response = await apiRequest(
        `/api/ai/chat-history/search?query=${encodeURIComponent(query)}&limit=${limit}`, 
        {
          method: 'GET',
          credentials: 'include',
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to search chat history');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error searching chat history:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get current session information
   */
  async getSessionInfo(): Promise<any> {
    try {
      const response = await apiRequest(`/api/sessions/current`, {
        method: 'GET',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get session info');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting session info:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get user sessions (requires authentication)
   */
  async getUserSessions(): Promise<any> {
    try {
      const response = await apiRequest(`/api/sessions/user-sessions`, {
        method: 'GET',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get user sessions');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting user sessions:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Deactivate a specific session
   */
  async deactivateSession(sessionId: string): Promise<any> {
    try {
      const response = await apiRequest(`/api/sessions/deactivate/${sessionId}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to deactivate session');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error deactivating session:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Deactivate all user sessions except current
   */
  async deactivateAllSessions(): Promise<any> {
    try {
      const response = await apiRequest(`/api/sessions/deactivate-all`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to deactivate sessions');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error deactivating all sessions:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Analyze all candidates in the system
   */
  async analyzeCandidates(): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/analyze-candidates`, {
        method: 'GET',
        headers: getAuthHeaders(), // Include JWT authorization headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to analyze candidates');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error analyzing candidates:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Analyze all jobs in the system
   */
  async analyzeJobs(): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/analyze-jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to analyze jobs');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error analyzing jobs:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get matching candidates report for a specific job
   * @param jobId - Job ID to get matching report for
   * @param forceRefresh - If true, bypasses cache and generates fresh insights (will deduct credits)
   */
  async getMatchingReport(jobId: string, forceRefresh: boolean = false): Promise<any> {
    try {
      const url = `/api/ai/matching-report/${jobId}${forceRefresh ? '?forceRefresh=true' : ''}`;
      const response = await apiRequest(url, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get matching report');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting matching report:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get comprehensive hiring analytics
   */
  async getHiringAnalytics(): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/hiring-analytics`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get hiring analytics');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting hiring analytics:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Test AI connection
   */
  async testConnection(): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/test-connection`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to test connection');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error testing connection:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get all candidates using existing API
   */
  async getCandidates(): Promise<any> {
    try {
      const response = await apiRequest(`/api/candidates`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get candidates');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting candidates:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get all chat sessions for current user
   */
  async getChatSessions(limit: number = 50): Promise<any> {
    try {
      const response = await apiRequest(`/api/chat-sessions?limit=${limit}`, {
        method: 'GET',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get chat sessions');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting chat sessions:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Create a new chat session
   */
  async createChatSession(title?: string): Promise<any> {
    try {
      const response = await apiRequest(`/api/chat-sessions/create`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
        body: JSON.stringify({ title: title || 'New Chat' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to create chat session');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error creating chat session:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Update chat session title
   */
  async updateChatSessionTitle(sessionId: string, title: string): Promise<any> {
    try {
      const response = await apiRequest(`/api/chat-sessions/${sessionId}/title`, {
        method: 'PUT',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to update chat session title');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error updating chat session title:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Delete a chat session
   */
  async deleteChatSession(sessionId: string): Promise<any> {
    try {
      const response = await apiRequest(`/api/chat-sessions/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to delete chat session');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error deleting chat session:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Toggle pin status of a chat session
   */
  async toggleChatSessionPin(sessionId: string): Promise<any> {
    try {
      const response = await apiRequest(`/api/chat-sessions/${sessionId}/pin`, {
        method: 'PUT',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to toggle chat session pin');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error toggling chat session pin:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get chat session history for a specific session
   */
  async getChatSessionHistory(sessionId: string, limit: number = 50): Promise<any> {
    try {
      const response = await apiRequest(`/api/chat-sessions/${sessionId}/history?limit=${limit}`, {
        method: 'GET',
        credentials: 'include',
        headers: getAuthHeaders(), // Include JWT authorization headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get chat session history');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting chat session history:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get all jobs using existing API
   */
  async getJobs(): Promise<any> {
    try {
      const response = await apiRequest(`/api/jobs`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get jobs');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting jobs:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Generate job description using existing AI API
   */
  async generateJobDescription(jobData: any): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/generate-job-description`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(jobData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to generate job description');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error generating job description:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Upload and analyze a file using AI
   */
  async analyzeFile(file: File): Promise<FileAnalysisResult> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('timestamp', new Date().toISOString());

      const authHeaders = getAuthHeaders();
      // Remove Content-Type for FormData - let browser set it with boundary
      const { 'Content-Type': _, ...headersWithoutContentType } = authHeaders;

      const response = await apiRequest(`/api/ai/analyze-file`, {
        method: 'POST',
        headers: headersWithoutContentType,
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to analyze file');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error analyzing file:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Execute an action suggested by the AI assistant
   */
  async executeAction(action: string, data?: any): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/execute-action`, {
        method: 'POST',
        headers: getAuthHeaders(), // Include JWT authorization headers
        body: JSON.stringify({
          action,
          data,
          timestamp: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to execute action');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error executing action:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get AI-powered insights about candidates
   */
  async getCandidateInsights(candidateId: string): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/candidate-insights/${candidateId}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get candidate insights');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting candidate insights:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get AI-powered insights about jobs
   */
  async getJobInsights(jobId: string): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/job-insights/${jobId}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get job insights');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting job insights:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Generate reports using AI
   */
  async generateReport(reportType: string, parameters?: any): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/generate-report`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          reportType,
          parameters,
          timestamp: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to generate report');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error generating report:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get suggested prompts based on context
   */
  async getSuggestedPrompts(context?: any): Promise<string[]> {
    try {
      const response = await apiRequest(`/api/ai/suggested-prompts`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          context,
          timestamp: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get suggested prompts');
      }

      const data = await response.json();
      return data.prompts || [];
    } catch (error: any) {
      console.error('Error getting suggested prompts:', error);
      return []; // Return empty array on error
    }
  }

  /**
   * Convert audio to text using Azure Speech Services
   */
  async speechToText(audioBlob: Blob): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const authHeaders = getAuthHeaders();
      // Remove Content-Type for FormData - let browser set it with boundary
      const { 'Content-Type': _, ...headersWithoutContentType } = authHeaders;

      const response = await apiRequest(`/api/ai/speech-to-text`, {
        method: 'POST',
        headers: headersWithoutContentType,
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to convert speech to text');
      }

      const data = await response.json();
      return data.text || '';
    } catch (error: any) {
      console.error('Error converting speech to text:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get AI-powered feedback on HR processes
   */
  async getFeedback(type: string, data: any): Promise<any> {
    try {
      const response = await apiRequest(`/api/ai/feedback`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          type,
          data,
          timestamp: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get AI feedback');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting AI feedback:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Get all jobs with limited data for matching interface
   */
  async getJobsForMatching(): Promise<any> {
    try {
      const response = await apiRequest(`/jobs`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw errorData; // Failed to get jobs for matching');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting jobs for matching:', error);
      throw new Error(error.message || 'Network error occurred');
    }
  }

  /**
   * Send a message to the AI assistant and handle a streamed response.
   */
  streamAssistantMessage(
    message: string,
    chatSessionId: string | undefined,
    onEvent: (eventData: any) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): AbortController {
    const controller = new AbortController();
    const signal = controller.signal;

    const body = JSON.stringify({
      userInput: message, // Matching the backend controller
      chatSessionId,
      timestamp: new Date().toISOString(),
    });

    // Check if we should use fallback directly (Sterling deployment)
    const shouldUseFallback = typeof window !== 'undefined' && window.location.href.includes('sterling');
    
    const tryStreamFetch = async (baseUrl: string): Promise<Response> => {
      return fetch(baseUrl + `/api/ai/chat-stream`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body,
        signal,
        credentials: 'include',
      });
    };

    const streamPromise = shouldUseFallback 
      ? (async () => {
          console.log('🌐 Sterling deployment detected, using fallback streaming API directly');
          const response = await fetch('/fallback-config.json');
          const config = response.ok ? await response.json() : {};
          const fallbackUrl = config.NEXT_PUBLIC_API_BASE_URL || 'https://api.seemplifyai.com';
          return tryStreamFetch(fallbackUrl);
        })()
      : tryStreamFetch(getCurrentApiBaseUrl())
          .catch(async (defaultError) => {
            console.warn('🔁 Default streaming API failed, trying fallback...', defaultError);
            const response = await fetch('/fallback-config.json');
            const config = response.ok ? await response.json() : {};
            const fallbackUrl = config.NEXT_PUBLIC_API_BASE_URL || 'https://api.seemplifyai.com';
            return tryStreamFetch(fallbackUrl);
          });

    streamPromise
      .then(async (response) => {
        if (!response.ok) {
          // Attempt to parse error from backend if possible
          try {
            const errorData = await response.json();
            throw new Error(errorData.msg || errorData.error || `HTTP error! status: ${response.status}`);
          } catch (e) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processText = (text: string) => {
          buffer += text;
          let eventEndIndex;
          // SSE events are separated by double newlines (\n\n)
          while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.substring(0, eventEndIndex);
            buffer = buffer.substring(eventEndIndex + 2); // Skip '\n\n'

            if (rawEvent.startsWith('data: ')) {
              const jsonData = rawEvent.substring('data: '.length);
              try {
                const parsedData = JSON.parse(jsonData);
                onEvent(parsedData);
                if (parsedData.type === 'stream_end') {
                  onComplete();
                  // No need to close reader here, 'done' will handle it
                  return; // Exit processing if stream ended
                }
              } catch (e) {
                console.error('Failed to parse SSE event JSON:', jsonData, e);
                // Optionally call onError for parsing errors
              }
            }
          }
        };

        function readStream() {
          reader.read().then(({ done, value }) => {
            if (done) {
              // Process any remaining buffer content before completing
              if (buffer.trim().length > 0) {
                  // This case might happen if the stream ends without a final \n\n
                  // and there's still data in the buffer.
                  // However, our server-side logic should ensure a stream_end event.
                  console.warn("Stream ended with unprocessed buffer:", buffer);
              }
              // onComplete should have been called by stream_end event
              return;
            }
            processText(decoder.decode(value, { stream: true }));
            readStream(); // Continue reading
          }).catch(error => {
            if (error.name === 'AbortError') {
              console.log('Stream fetch aborted');
              onComplete(); // Or a specific onAbort callback
              return;
            }
            console.error('Stream reading error:', error);
            onError(error);
            onComplete(); // Ensure onComplete is called on error too
          });
        }
        readStream();
      })
      .catch(error => {
        if (error.name === 'AbortError') {
          console.log('Fetch POST request aborted');
        } else {
          console.error('Error sending streaming message:', error);
          onError(error);
        }
        onComplete(); // Ensure onComplete is called on fetch error
      });

    return controller; // Return AbortController to allow aborting the fetch
  }
}

export default new AssistantService();

const { AzureOpenAI } = require('openai');

class AzureOpenAIService {
  constructor() {
    this.endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    this.apiKey = process.env.AZURE_OPENAI_API_KEY;
    this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4.1'; // Ensure this matches your Azure deployment
    this.apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview";

    if (!this.endpoint || !this.apiKey) {
      console.warn("Azure OpenAI credentials (ENDPOINT or API_KEY) are missing in environment variables.");
    }

    try {
      if (process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY) {
        this.client = new AzureOpenAI({
          endpoint: this.endpoint,
          apiKey: this.apiKey,
          apiVersion: this.apiVersion,
          deployment: this.deploymentName
        });
      } else {
        console.warn("Skipping Azure OpenAI initialization: credentials missing");
        this.client = null;
      }
    } catch (error) {
        console.error("Failed to initialize Azure OpenAI Client:", error);
        this.client = null;
    }
  }

  async getChatCompletions(messages, options = {}) {
    const maxRetries = 3;
    let attempt = 0;
    
    // Default options
    const requestOptions = {
        temperature: options.temperature || 0.7,
        max_tokens: options.maxTokens || 2000
    };

    while (attempt < maxRetries) {
      try {
        if (!this.client) {
            throw new Error("Azure OpenAI Client is not initialized.");
        }

        const result = await this.client.chat.completions.create({
            model: this.deploymentName,
            messages: messages,
            ...requestOptions
        });
        return result;
      } catch (error) {
        console.warn(`Azure OpenAI attempt ${attempt + 1} failed: ${error.message}`);
        
        attempt++;
        if (attempt >= maxRetries || !this.isRetryable(error)) {
          console.error("Max retries reached or non-retryable error.", error);
          throw error;
        }
        
        const delayMs = 1000 * Math.pow(2, attempt); // Exponential backoff: 2s, 4s, 8s
        await this.delay(delayMs);
      }
    }
  }

  isRetryable(error) {
    // Check for rate limit (429) or server errors (5xx)
    // Azure SDK errors might have code or statusCode
    const statusCode = error.statusCode || error.status;
    return statusCode === 429 || (statusCode >= 500 && statusCode < 600);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AzureOpenAIService();

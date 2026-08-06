import { AzureOpenAI } from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Sterling Bank knowledge base
const knowledgeBasePath = path.join(__dirname, '../data/sterlingBankKnowledge.json');
const sterlingKnowledge = JSON.parse(fs.readFileSync(knowledgeBasePath, 'utf8'));

// Initialize Azure OpenAI client
const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview',
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4',
});

const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4';

export class AzureOpenAIService {
  // Generate email response using AI
  static async generateEmailResponse(emailContent, customerEmail, senderName) {
    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(emailContent, customerEmail, senderName);

      console.log('🤖 Generating AI response for email...');

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const response = await client.chat.completions.create({
        model: deploymentName,
        messages: messages,
        temperature: 0.7,
        max_tokens: 800,
        top_p: 0.95,
      });

      const aiResponse = response.choices[0]?.message?.content || '';
      
      // Check if AI classified this as marketing/automated
      if (aiResponse.trim() === 'MARKETING_EMAIL') {
        console.log('📧 AI detected marketing/automated email - skipping');
        return {
          response: null,
          needsEscalation: false,
          isMarketing: true,
          reason: 'Marketing or automated email',
          confidence: 'high',
        };
      }
      
      // Clean the AI response to remove any Subject/headers
      const cleanedResponse = this.cleanAIResponse(aiResponse);
      
      console.log('✅ AI response generated successfully');
      console.log('   Original length:', aiResponse.length);
      console.log('   Cleaned length:', cleanedResponse.length);
      
      return {
        response: cleanedResponse,
        needsEscalation: this.checkIfNeedsEscalation(emailContent),
        isMarketing: false,
        confidence: response.choices[0]?.message?.role === 'assistant' ? 'high' : 'medium',
      };
    } catch (error) {
      console.error('❌ Error generating AI response:', error);
      throw new Error('Failed to generate AI response: ' + error.message);
    }
  }

  // Build system prompt with Sterling Bank context
  static buildSystemPrompt() {
    return `You are a professional and helpful customer service representative for Sterling Bank Nigeria.

BANK INFORMATION:
- Name: ${sterlingKnowledge.bankInfo.name}
- Contact: ${sterlingKnowledge.bankInfo.contactCenter}
- Email: ${sterlingKnowledge.bankInfo.email}
- USSD Code: ${sterlingKnowledge.bankInfo.ussdCode}

YOUR ROLE:
- Provide accurate, helpful responses to customer inquiries
- Be professional, courteous, and empathetic
- Reference Sterling Bank products and services accurately
- Provide specific next steps and contact information
- Maintain a warm, friendly Nigerian banking tone

RESPONSE GUIDELINES:
1. Always start with a courteous greeting
2. Address the customer's specific question or concern
3. Provide clear, actionable steps
4. Include relevant Sterling Bank contact information
5. End with a professional closing
6. Keep responses concise but complete (200-400 words)
7. Use proper Nigerian English
8. Be empathetic and customer-focused

AVAILABLE PRODUCTS & SERVICES:
${JSON.stringify(sterlingKnowledge.products, null, 2)}

COMMON FAQS:
${sterlingKnowledge.faqs.map(faq => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n')}

IMPORTANT:
- If you don't know specific information, direct customer to call ${sterlingKnowledge.bankInfo.contactCenter}
- Never make up interest rates or specific fees - say "Please contact us for current rates"
- For account-specific issues, advise customer to visit a branch with valid ID
- For urgent issues (fraud, lost cards), immediately provide hotline number

EMAIL CLASSIFICATION (CRITICAL):
Before generating ANY response, you MUST classify the email type.

CUSTOMER INQUIRY - Respond if email is:
- Personal question about banking services
- Account opening or product inquiry
- Complaint or feedback about service
- Request for assistance or support
- Transaction or account issue
- Legitimate customer communication

MARKETING/AUTOMATED - DO NOT RESPOND if email is:
- Newsletter or promotional content
- Marketing campaigns or sales offers
- Automated notifications (receipts, confirmations, shipping)
- From no-reply@, noreply@, or donotreply@ addresses
- Contains "unsubscribe" or "manage preferences" links
- Generic mass email (not personally addressed)
- System notifications or alerts
- Calendar invites or meeting requests
- Order confirmations or tracking updates

RESPONSE FORMAT:
If the email is marketing/automated, respond with ONLY:
MARKETING_EMAIL

If it's a genuine customer inquiry, generate the appropriate response.

Remember: You represent Sterling Bank. Be helpful, accurate, and professional.`;
  }

  // Build user prompt
  static buildUserPrompt(emailContent, customerEmail, senderName) {
    return `CUSTOMER EMAIL FROM: ${senderName} (${customerEmail})

EMAIL CONTENT:
${emailContent}

CRITICAL INSTRUCTIONS:
- Generate ONLY the email body content
- Do NOT include "Subject:" line or any subject text
- Do NOT include "From:", "To:", or any email headers
- Start directly with the greeting and content
- Use proper paragraphs separated by blank lines
- End with professional closing and contact info

Your response should be ONLY the body text, formatted with paragraphs.
Example format:
"Dear Customer,

Thank you for contacting Sterling Bank regarding...

Best regards,
Sterling Bank Customer Service"

Generate the response body now (NO SUBJECT LINE):`;
  }

  // Clean AI response to remove Subject lines and headers
  static cleanAIResponse(aiResponse) {
    if (!aiResponse) return '';

    let cleaned = aiResponse.trim();

    // Remove lines starting with common email headers
    const headerPatterns = [
      /^Subject:.*$/gmi,
      /^Re:.*$/gmi,
      /^From:.*$/gmi,
      /^To:.*$/gmi,
      /^Cc:.*$/gmi,
      /^Date:.*$/gmi,
    ];

    headerPatterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });

    // Remove excessive blank lines at the start
    cleaned = cleaned.replace(/^\s*\n+/, '');
    
    // Remove excessive blank lines (more than 2 consecutive)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
  }

  // Check if email needs human escalation
  static checkIfNeedsEscalation(emailContent) {
    const lowerContent = emailContent.toLowerCase();
    
    const escalationKeywords = sterlingKnowledge.escalationKeywords;
    
    const needsEscalation = escalationKeywords.some(keyword => 
      lowerContent.includes(keyword.toLowerCase())
    );

    // Also check for multiple exclamation marks or all caps (angry)
    const hasExcessiveCaps = (emailContent.match(/[A-Z]/g) || []).length / emailContent.length > 0.5;
    const hasMultipleExclamation = (emailContent.match(/!/g) || []).length > 3;

    return needsEscalation || hasExcessiveCaps || hasMultipleExclamation;
  }

  // Analyze email intent
  static async analyzeEmailIntent(emailContent) {
    try {
      const prompt = `Analyze this customer email and categorize the intent:

Email: "${emailContent}"

Respond with ONLY ONE of these categories:
- account_inquiry
- card_issue
- loan_inquiry
- transfer_issue
- app_problem
- complaint
- general_inquiry
- account_opening

Category:`;

      const messages = [
        { role: 'user', content: prompt },
      ];

      const response = await client.chat.completions.create({
        model: deploymentName,
        messages: messages,
        temperature: 0.3,
        max_tokens: 50,
      });

      const intent = response.choices[0]?.message?.content?.trim().toLowerCase() || 'general_inquiry';
      
      return intent;
    } catch (error) {
      console.error('Error analyzing intent:', error);
      return 'general_inquiry';
    }
  }

  // Get knowledge base for reference
  static getKnowledgeBase() {
    return sterlingKnowledge;
  }
}

export default AzureOpenAIService;


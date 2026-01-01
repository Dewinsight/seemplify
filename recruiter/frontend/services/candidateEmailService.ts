import { apiRequest } from './apiConfig';

interface EmailSettings {
  enableAdvancementEmails?: boolean;
  enableRejectionEmails?: boolean;
  enableShortlistEmails?: boolean;
  autoSendRejections?: boolean;
  senderName?: string;
  customTemplates?: {
    advancement?: string;
    shortlist?: string;
    rejection?: string;
    shortlistRejection?: string;
  };
  emailSignature?: string;
  ccEmails?: string[];
  bccEmails?: string[];
  lastUpdated?: Date;
  updatedBy?: string;
}

interface CandidateEmailData {
  candidateId: string;
  jobId: string;
  stage?: string;
}

interface EmailResult {
  success: boolean;
  message: string;
  emailResult?: any;
  candidate?: {
    id: string;
    name: string;
    email: string;
  };
}

interface BulkEmailResult {
  success: boolean;
  message: string;
  results: {
    total: number;
    sent: number;
    failed: number;
    results: any[];
  };
  skippedCandidates?: Array<{
    candidateId: string;
    name: string;
    reason: string;
  }>;
}

class CandidateEmailService {
  /**
   * Send rejection email to a single candidate
   */
  async sendRejectionEmail(
    candidateId: string,
    jobId: string,
    reason?: string,
    stage?: string,
    isShortlistRejection = false
  ): Promise<EmailResult> {
    const response = await apiRequest('/api/candidate-emails/send-rejection', {
      method: 'POST',
      body: JSON.stringify({
        candidateId,
        jobId,
        reason,
        stage,
        isShortlistRejection
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send rejection email');
    }

    return response.json();
  }

  /**
   * Send rejection emails to multiple candidates
   */
  async sendBulkRejectionEmails(
    candidates: CandidateEmailData[],
    reason?: string,
    isShortlistRejection = false
  ): Promise<BulkEmailResult> {
    const response = await apiRequest('/api/candidate-emails/send-bulk-rejection', {
      method: 'POST',
      body: JSON.stringify({
        candidates,
        reason,
        isShortlistRejection
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send bulk rejection emails');
    }

    return response.json();
  }

  /**
   * Get email notification settings for a job
   */
  async getEmailSettings(jobId: string): Promise<{ emailSettings: EmailSettings; jobTitle: string }> {
    const response = await apiRequest(`/api/candidate-emails/job/${jobId}/email-settings`, {
      method: 'GET'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get email settings');
    }

    return response.json();
  }

  /**
   * Update email notification settings for a job
   */
  async updateEmailSettings(jobId: string, settings: EmailSettings): Promise<{ emailSettings: EmailSettings }> {
    const response = await apiRequest(`/api/candidate-emails/job/${jobId}/email-settings`, {
      method: 'PUT',
      body: JSON.stringify(settings)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update email settings');
    }

    return response.json();
  }

  /**
   * Send a test email to verify configuration
   */
  async sendTestEmail(
    jobId: string,
    testEmail: string,
    templateType: 'advancement' | 'shortlist' | 'rejection' | 'shortlist-rejection'
  ): Promise<EmailResult> {
    const response = await apiRequest('/api/candidate-emails/test-email', {
      method: 'POST',
      body: JSON.stringify({
        jobId,
        testEmail,
        templateType
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send test email');
    }

    return response.json();
  }
}

export default new CandidateEmailService();
export type { EmailSettings, CandidateEmailData, EmailResult, BulkEmailResult };

import { User } from '../models/User.js';
import { sendCampaign } from '../services/campaignSendService.js';

/**
 * Simple CSV parser - handles quoted fields and basic CSV format.
 */
function parseCsvContent(csvContent) {
  const lines = csvContent.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if ((c === ',' && !inQuotes) || (c === '\n' && !inQuotes)) {
        result.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => {
      row[h] = (values[j] || '').replace(/^"|"$/g, '');
    });
    rows.push(row);
  }
  return { headers, rows };
}

/**
 * Parse CSV content and return headers + rows for preview and field mapping.
 * POST /api/campaigns/parse-csv
 * Body: { csvContent: string }
 */
export const parseCsv = async (req, res) => {
  try {
    const { csvContent } = req.body;

    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'csvContent is required',
      });
    }

    const { headers, rows } = parseCsvContent(csvContent);

    // Validate at least one row and email-like column
    const hasEmail = headers.some((h) => /email/i.test(String(h)));
    if (!hasEmail && rows.length > 0) {
      const firstRow = rows[0];
      const hasEmailValue = Object.values(firstRow || {}).some(
        (v) => typeof v === 'string' && v.includes('@')
      );
      if (!hasEmailValue) {
        return res.status(400).json({
          success: false,
          message: 'CSV must contain an email column or email-like values',
        });
      }
    }

    res.json({
      success: true,
      data: {
        headers,
        rows,
        totalRecipients: rows.length,
        preview: rows.slice(0, 5),
      },
    });
  } catch (error) {
    console.error('Parse CSV error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to parse CSV',
    });
  }
};

/**
 * Send campaign emails.
 * POST /api/campaigns/send
 * Body: {
 *   recipients: Array<object>,
 *   subjectTemplate: string,
 *   bodyTemplate: string,
 *   emailField?: string,
 *   nameField?: string,
 * }
 */
export const sendCampaignEmails = async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const {
      recipients,
      subjectTemplate,
      bodyTemplate,
      emailField = 'email',
      nameField = 'name',
    } = req.body;

    if (!recipients?.length) {
      return res.status(400).json({
        success: false,
        message: 'recipients is required and must not be empty',
      });
    }

    if (!subjectTemplate || typeof subjectTemplate !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'subjectTemplate is required',
      });
    }

    if (!bodyTemplate || typeof bodyTemplate !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'bodyTemplate is required',
      });
    }

    const user = await User.findById(userId);
    if (!user?.nylasGrantId) {
      return res.status(400).json({
        success: false,
        message: 'Email not connected. Connect your email first.',
      });
    }

    const result = await sendCampaign({
      grantId: user.nylasGrantId,
      recipients,
      subjectTemplate,
      bodyTemplate,
      emailField,
      nameField,
      onProgress: (sent, failed, total, lastError) => {
        console.log(`Campaign progress: ${sent + failed}/${total} (sent: ${sent}, failed: ${failed})`);
        if (lastError) console.log('   Last error:', lastError);
      },
    });

    res.json({
      success: true,
      message: 'Campaign completed',
      data: {
        sent: result.sent,
        failed: result.failed,
        total: recipients.length,
        errors: result.errors.slice(0, 10), // First 10 errors for debugging
      },
    });
  } catch (error) {
    console.error('Send campaign error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send campaign',
    });
  }
};

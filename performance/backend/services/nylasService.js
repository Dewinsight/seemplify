/**
 * Nylas Integration Service
 *
 * Provides calendar scheduling, video conferencing, and transcript handling
 * for 1:1 meetings in the performance management system.
 *
 * Features:
 * - Calendar event creation and management
 * - Video/audio meeting generation
 * - Transcript extraction from recordings
 * - Webhook handling for meeting events
 */

const axios = require('axios');

// Nylas API configuration
const NYLAS_API_URL = process.env.NYLAS_API_URL || 'https://api.us.nylas.com/v3';
const NYLAS_CLIENT_ID = process.env.NYLAS_CLIENT_ID;
const NYLAS_CLIENT_SECRET = process.env.NYLAS_CLIENT_SECRET;
const NYLAS_GRANT_ID = process.env.NYLAS_GRANT_ID;
const NYLAS_WEBHOOK_SECRET = process.env.NYLAS_WEBHOOK_SECRET;

/**
 * Create axios instance for Nylas API
 */
const createNylasClient = (accessToken) => {
  return axios.create({
    baseURL: NYLAS_API_URL,
    headers: {
      'Authorization': `Bearer ${accessToken || NYLAS_CLIENT_SECRET}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
};

/**
 * Check if Nylas is configured
 */
const isNylasConfigured = () => {
  return !!(NYLAS_CLIENT_ID && NYLAS_CLIENT_SECRET);
};

/**
 * Generate OAuth URL for Nylas connection
 */
const generateAuthUrl = (redirectUri, state) => {
  if (!isNylasConfigured()) {
    throw new Error('Nylas not configured');
  }

  const params = new URLSearchParams({
    client_id: NYLAS_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: state,
    access_type: 'offline',
    provider: 'google' // or 'microsoft', 'icloud', etc.
  });

  return `https://api.us.nylas.com/v3/connect/auth?${params.toString()}`;
};

/**
 * Exchange authorization code for access token
 */
const exchangeCodeForToken = async (code, redirectUri) => {
  try {
    const response = await axios.post(`${NYLAS_API_URL}/connect/token`, {
      client_id: NYLAS_CLIENT_ID,
      client_secret: NYLAS_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    });

    return {
      accessToken: response.data.access_token,
      grantId: response.data.grant_id,
      email: response.data.email,
      provider: response.data.provider
    };
  } catch (error) {
    console.error('Nylas token exchange error:', error.response?.data || error.message);
    throw new Error('Failed to exchange Nylas authorization code');
  }
};

/**
 * Create a calendar event with optional video conferencing
 */
const createCalendarEvent = async (grantId, eventData) => {
  const client = createNylasClient();

  try {
    const {
      title,
      description,
      startTime,
      endTime,
      participants,
      location,
      conferencing = true,
      reminderMinutes = 15,
      metadata = {}
    } = eventData;

    const eventPayload = {
      title,
      description,
      when: {
        start_time: Math.floor(new Date(startTime).getTime() / 1000),
        end_time: Math.floor(new Date(endTime).getTime() / 1000)
      },
      participants: participants.map(p => ({
        email: p.email,
        name: p.name,
        status: 'noreply'
      })),
      location: location || 'Virtual Meeting',
      reminders: {
        use_default: false,
        overrides: [
          { reminder_minutes: reminderMinutes, reminder_method: 'popup' },
          { reminder_minutes: reminderMinutes, reminder_method: 'email' }
        ]
      },
      metadata
    };

    // Add conferencing if requested
    if (conferencing) {
      eventPayload.conferencing = {
        provider: 'Google Meet', // or 'Zoom', 'Microsoft Teams'
        autocreate: {
          settings: {
            auto_admit: true,
            start_on_join: true
          }
        }
      };
    }

    const response = await client.post(`/grants/${grantId}/events`, eventPayload, {
      params: { calendar_id: 'primary' }
    });

    return {
      eventId: response.data.data.id,
      calendarId: response.data.data.calendar_id,
      conferenceUrl: response.data.data.conferencing?.details?.url,
      conferenceDetails: response.data.data.conferencing?.details,
      htmlLink: response.data.data.html_link,
      status: response.data.data.status
    };
  } catch (error) {
    console.error('Create calendar event error:', error.response?.data || error.message);
    throw new Error('Failed to create calendar event');
  }
};

/**
 * Update an existing calendar event
 */
const updateCalendarEvent = async (grantId, eventId, updates) => {
  const client = createNylasClient();

  try {
    const updatePayload = {};

    if (updates.title) updatePayload.title = updates.title;
    if (updates.description) updatePayload.description = updates.description;
    if (updates.startTime && updates.endTime) {
      updatePayload.when = {
        start_time: Math.floor(new Date(updates.startTime).getTime() / 1000),
        end_time: Math.floor(new Date(updates.endTime).getTime() / 1000)
      };
    }
    if (updates.location) updatePayload.location = updates.location;
    if (updates.participants) {
      updatePayload.participants = updates.participants.map(p => ({
        email: p.email,
        name: p.name
      }));
    }

    const response = await client.put(`/grants/${grantId}/events/${eventId}`, updatePayload, {
      params: { calendar_id: 'primary' }
    });

    return response.data.data;
  } catch (error) {
    console.error('Update calendar event error:', error.response?.data || error.message);
    throw new Error('Failed to update calendar event');
  }
};

/**
 * Delete/cancel a calendar event
 */
const deleteCalendarEvent = async (grantId, eventId) => {
  const client = createNylasClient();

  try {
    await client.delete(`/grants/${grantId}/events/${eventId}`, {
      params: { calendar_id: 'primary' }
    });
    return { success: true };
  } catch (error) {
    console.error('Delete calendar event error:', error.response?.data || error.message);
    throw new Error('Failed to delete calendar event');
  }
};

/**
 * Get calendar event details
 */
const getCalendarEvent = async (grantId, eventId) => {
  const client = createNylasClient();

  try {
    const response = await client.get(`/grants/${grantId}/events/${eventId}`, {
      params: { calendar_id: 'primary' }
    });
    return response.data.data;
  } catch (error) {
    console.error('Get calendar event error:', error.response?.data || error.message);
    throw new Error('Failed to get calendar event');
  }
};

/**
 * List upcoming events
 */
const listUpcomingEvents = async (grantId, options = {}) => {
  const client = createNylasClient();

  try {
    const params = {
      calendar_id: 'primary',
      start: options.startTime || Math.floor(Date.now() / 1000),
      end: options.endTime || Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
      limit: options.limit || 50
    };

    const response = await client.get(`/grants/${grantId}/events`, { params });
    return response.data.data || [];
  } catch (error) {
    console.error('List events error:', error.response?.data || error.message);
    throw new Error('Failed to list calendar events');
  }
};

/**
 * Get available time slots for scheduling
 */
const getAvailability = async (grantId, options) => {
  const client = createNylasClient();

  try {
    const {
      startTime,
      endTime,
      durationMinutes = 30,
      participants = []
    } = options;

    const response = await client.post('/calendars/availability', {
      participants: [
        { email: participants[0]?.email, calendar_ids: ['primary'] }
      ],
      start_time: Math.floor(new Date(startTime).getTime() / 1000),
      end_time: Math.floor(new Date(endTime).getTime() / 1000),
      duration_minutes: durationMinutes,
      availability_rules: {
        buffer: {
          before: 5,
          after: 5
        }
      }
    });

    return response.data.data?.time_slots || [];
  } catch (error) {
    console.error('Get availability error:', error.response?.data || error.message);
    throw new Error('Failed to get availability');
  }
};

/**
 * Create a scheduler page for booking
 */
const createSchedulerPage = async (grantId, config) => {
  const client = createNylasClient();

  try {
    const response = await client.post('/scheduling/configurations', {
      participants: [{
        email: config.hostEmail,
        availability: {
          calendar_ids: ['primary']
        },
        booking: {
          calendar_id: 'primary'
        }
      }],
      availability: {
        duration_minutes: config.durationMinutes || 30,
        interval_minutes: config.intervalMinutes || 15,
        round_to: 15
      },
      event_booking: {
        title: config.title || '1:1 Meeting',
        description: config.description,
        location: config.location || 'Virtual'
      },
      scheduler: {
        available_days_in_future: 30,
        min_cancellation_notice: 60,
        min_booking_notice: 60
      }
    });

    return {
      configurationId: response.data.data.id,
      bookingUrl: `https://scheduler.nylas.com/${response.data.data.id}`
    };
  } catch (error) {
    console.error('Create scheduler error:', error.response?.data || error.message);
    throw new Error('Failed to create scheduler page');
  }
};

/**
 * Verify Nylas webhook signature
 */
const verifyWebhookSignature = (signature, body) => {
  if (!NYLAS_WEBHOOK_SECRET) {
    console.warn('Nylas webhook secret not configured');
    return false;
  }

  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', NYLAS_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  return signature === expectedSignature;
};

/**
 * Parse webhook event data
 */
const parseWebhookEvent = (webhookData) => {
  const { trigger, data } = webhookData;

  return {
    type: trigger,
    eventId: data?.object?.id,
    grantId: data?.object?.grant_id,
    calendarId: data?.object?.calendar_id,
    status: data?.object?.status,
    conferencing: data?.object?.conferencing,
    participants: data?.object?.participants,
    when: data?.object?.when,
    metadata: data?.object?.metadata
  };
};

/**
 * Meeting Recording and Transcript Handling
 * Note: Nylas doesn't directly provide recording/transcription.
 * This integrates with external services or uses manual upload.
 */

/**
 * Process meeting recording URL (from Google Meet, Zoom, etc.)
 * This is called when a recording becomes available
 */
const processRecordingUrl = async (recordingUrl, meetingId) => {
  // This would integrate with transcription services like:
  // - Assembly AI
  // - Deepgram
  // - Rev.ai
  // - Google Speech-to-Text

  console.log(`Processing recording for meeting ${meetingId}: ${recordingUrl}`);

  // For now, return a placeholder - actual implementation depends on recording source
  return {
    recordingUrl,
    meetingId,
    status: 'pending_transcription',
    estimatedCompletionTime: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
  };
};

/**
 * Fetch transcript from transcription service
 * This is called after transcription is complete
 */
const fetchTranscript = async (transcriptionJobId) => {
  // Placeholder for actual transcription service integration
  return {
    jobId: transcriptionJobId,
    status: 'completed',
    transcript: null, // Would contain the actual transcript
    speakers: [],
    duration: 0
  };
};

module.exports = {
  isNylasConfigured,
  generateAuthUrl,
  exchangeCodeForToken,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  listUpcomingEvents,
  getAvailability,
  createSchedulerPage,
  verifyWebhookSignature,
  parseWebhookEvent,
  processRecordingUrl,
  fetchTranscript
};

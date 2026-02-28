const Nylas = require('nylas').default;
const configLoader = require('../config/configLoader');
const emailService = require('./emailService');
const DEFAULT_ORGANIZATION_NAME =
  process.env.DEFAULT_ORGANIZATION_NAME ||
  process.env.ORGANIZATION_NAME ||
  process.env.BREVO_SENDER_NAME ||
  'Organization';

class NylasV3Service {
  constructor() {
    this.apiKey = process.env.NYLAS_API_KEY;
    this.clientId = process.env.NYLAS_CLIENT_ID;
    this.clientSecret = process.env.NYLAS_CLIENT_SECRET;
    
    // Dynamic redirect URI from JSON config based on environment (dev vs production)
    // Uses app.config.json which automatically selects URL based on NODE_ENV
    this.redirectUri = configLoader.getCallbackUrl();
    
    this.region = process.env.NYLAS_REGION || 'us';
    this.apiUri = process.env.NYLAS_API_URI || 'https://api.us.nylas.com';
    
    this.nylas = new Nylas({
      apiKey: this.apiKey,
      apiUri: this.apiUri
    });
    
    console.log('🔧 NylasV3Service initialized:');
    console.log('   API URI:', this.apiUri);
    console.log('   Region:', this.region);
    console.log('   Redirect URI:', this.redirectUri);
    console.log('   Environment:', configLoader.getEnvironment());
    console.log('   Base URL:', configLoader.getBaseUrl());
    console.log('   API Key present:', !!this.apiKey);

    // Avoid spamming the logs for every Teams meeting creation.
    this._teamsAdminWarningLogged = false;
  }

    // Helper method to generate Basic Auth credentials for Admin API operations
  getBasicAuthHeader() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('NYLAS_CLIENT_ID and NYLAS_CLIENT_SECRET must be set in environment variables');
    }
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Get a Nylas SDK instance with custom credentials or default
   * @param {Object} accountCredentials - Optional custom account credentials
   * @returns {Nylas} Nylas SDK instance
   */
  getNylasInstance(accountCredentials = null) {
    if (accountCredentials) {
      const region = accountCredentials.region || 'us';
      const apiUri = `https://api.${region}.nylas.com`;
      
      console.log(`📦 Creating Nylas SDK instance with custom credentials (${apiUri})`);
      
      return new Nylas({
        apiKey: accountCredentials.apiKey,
        apiUri: apiUri
      });
    }
    
    // Return default instance
    return this.nylas;
  }

  formatIcsTimestamp(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  }

  escapeIcsText(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  buildIcsInvite({
    uid,
    title,
    description,
    location,
    startTime,
    endTime,
    organizerEmail,
    organizerName,
    attendeeEmail,
    attendeeName
  }) {
    const dtStamp = this.formatIcsTimestamp(new Date());
    const dtStart = this.formatIcsTimestamp(startTime);
    const dtEnd = this.formatIcsTimestamp(endTime);

    if (!dtStart || !dtEnd || !dtStamp) {
      return null;
    }

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${this.escapeIcsText(DEFAULT_ORGANIZATION_NAME)}//Interview Scheduler//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${this.escapeIcsText(uid)}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${this.escapeIcsText(title)}`,
      `DESCRIPTION:${this.escapeIcsText(description)}`,
      `LOCATION:${this.escapeIcsText(location)}`,
      organizerEmail
        ? `ORGANIZER;CN=${this.escapeIcsText(organizerName || organizerEmail)}:mailto:${organizerEmail}`
        : '',
      attendeeEmail
        ? `ATTENDEE;CN=${this.escapeIcsText(attendeeName || attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendeeEmail}`
        : '',
      'SEQUENCE:0',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
  }

  async sendBrevoCalendarInviteFallback(event, requestBody, eventData) {
    try {
      const fallbackEnabled = process.env.ENABLE_BREVO_CALENDAR_INVITE_FALLBACK === 'true';
      if (!fallbackEnabled) {
        return;
      }

      const participants = Array.isArray(requestBody?.participants) ? requestBody.participants : [];
      if (participants.length === 0) {
        return;
      }

      const organizerEmail = event?.organizer?.email || '';
      const organizerName = event?.organizer?.name || '';
      const senderName = eventData?.organizationName || organizerName || DEFAULT_ORGANIZATION_NAME;
      const meetingLink =
        event?.conferencing?.details?.url ||
        event?.conferencing?.details?.meeting_url ||
        event?.conferencing?.join_url ||
        eventData?.conferencing?.details?.url ||
        '';

      const startTimeIso = event?.when?.startTime
        ? new Date(event.when.startTime * 1000).toISOString()
        : eventData?.startTime;
      const endTimeIso = event?.when?.endTime
        ? new Date(event.when.endTime * 1000).toISOString()
        : eventData?.endTime;

      const location = event?.location || (meetingLink || eventData?.location || 'Video Call');
      const descriptionParts = [
        event?.description || eventData?.description || '',
        meetingLink ? `Join meeting: ${meetingLink}` : ''
      ].filter(Boolean);
      const description = descriptionParts.join('\n\n');
      const startLabel = startTimeIso ? new Date(startTimeIso).toUTCString() : 'TBD';
      const endLabel = endTimeIso ? new Date(endTimeIso).toUTCString() : 'TBD';

      const uniqueRecipients = new Map();
      for (const participant of participants) {
        const email = String(participant?.email || '').trim().toLowerCase();
        if (!email) {
          continue;
        }
        if (!uniqueRecipients.has(email)) {
          uniqueRecipients.set(email, {
            email,
            name: participant?.name || participant?.email || email
          });
        }
      }

      console.log(`📅 [Calendar Fallback] Sending .ics invites to ${uniqueRecipients.size} recipients`);
      for (const recipient of uniqueRecipients.values()) {
        try {
          const icsContent = this.buildIcsInvite({
            uid: event?.icalUid || `${event?.id || Date.now()}@smarthr.aiinnigeria.com`,
            title: event?.title || eventData?.title || 'Interview Invitation',
            description,
            location,
            startTime: startTimeIso,
            endTime: endTimeIso,
            organizerEmail,
            organizerName,
            attendeeEmail: recipient.email,
            attendeeName: recipient.name
          });

          if (!icsContent) {
            continue;
          }

          const messageHtml = `
            <p>A calendar invite is attached for your interview schedule.</p>
            <p><strong>Title:</strong> ${event?.title || eventData?.title || 'Interview Invitation'}</p>
            <p><strong>Start:</strong> ${startLabel}</p>
            <p><strong>End:</strong> ${endLabel}</p>
            ${meetingLink ? `<p><strong>Meeting Link:</strong> <a href="${meetingLink}">${meetingLink}</a></p>` : ''}
          `;

          await emailService.sendUserNotification(
            recipient.email,
            `${senderName} - Calendar Invite: ${event?.title || eventData?.title || 'Interview'}`,
            messageHtml,
            {
              senderName,
              htmlContent: messageHtml,
              attachments: [
                {
                  name: 'interview-invite.ics',
                  content: Buffer.from(icsContent, 'utf8').toString('base64')
                }
              ]
            }
          );
        } catch (recipientError) {
          console.error(`Calendar invite fallback failed for ${recipient.email}:`, recipientError.message);
        }
      }
    } catch (error) {
      console.error('Calendar invite fallback processing failed:', error.message);
    }
  }
  
  // Grant management (v3 authentication)
  async createAuthUrl(stateData, provider = 'google', forceAccountSelection = false, accountCredentials = null) {
    try {
      // Use provided credentials or fall back to environment variables
      const clientId = accountCredentials?.clientId || this.clientId;
      // redirectUri ALWAYS comes from configLoader - no fallback, no database override
      const redirectUri = this.redirectUri;
      // Define provider-specific scopes
      const getProviderScopes = (provider) => {
        switch (provider.toLowerCase()) {
          case 'google':
            return [
              // Calendar scopes
              'https://www.googleapis.com/auth/calendar',
              'https://www.googleapis.com/auth/userinfo.email',
              // Email scopes for sending interview invitations
              'https://www.googleapis.com/auth/gmail.send',
              'https://www.googleapis.com/auth/gmail.compose'
            ];
          case 'microsoft':
          case 'outlook':
          case 'azure':
            return [
              // Calendar scopes
              'Calendars.ReadWrite',
              'OnlineMeetings.ReadWrite',
              'User.Read',
              // Email scopes for sending interview invitations
              'Mail.Send',
              'Mail.ReadWrite'
            ];
          default:
            console.warn(`Unknown provider: ${provider}, using Google scopes as fallback`);
            return [
              'https://www.googleapis.com/auth/calendar',
              'https://www.googleapis.com/auth/userinfo.email',
              'https://www.googleapis.com/auth/gmail.send',
              'https://www.googleapis.com/auth/gmail.compose'
            ];
        }
      };

      const authParams = {
        clientId: clientId,
        provider: provider,
        redirectUri: redirectUri,
        scope: getProviderScopes(provider),
        state: stateData // Include user data in state for callback handling
      };

      console.log(`🔗 Creating auth URL for provider: ${provider}`);
      console.log(`📋 Using scopes: ${authParams.scope.join(', ')}`);
      console.log(`📧 NOTE: Email scopes included for interview notifications`);

      // For account switching, add timestamp to state
      // NOTE: Nylas v3 doesn't support prompt parameter - users must manually select account in OAuth flow
      if (forceAccountSelection) {
        console.log('🔄 Account switching requested - user will need to select account manually');
        console.log('📧 NOTE: Email permissions will be requested during re-authentication');
        authParams.state = JSON.stringify({
          ...JSON.parse(stateData),
          forceAccountSelection: true,
          timestamp: Date.now()
        });
      }

      // Generate the OAuth URL
      const authUrl = this.nylas.auth.urlForOAuth2(authParams);
      
      return authUrl;
    } catch (error) {
      console.error('Error creating auth URL:', error);
      throw error;
    }
  }

  async exchangeCodeForGrant(code, accountCredentials = null) {
    try {
      console.log('Exchanging code for grant with Nylas v3...');
      
      // Use provided credentials or fall back to environment variables
      const clientId = accountCredentials?.clientId || this.clientId;
      const clientSecret = accountCredentials?.clientSecret || this.clientSecret;
      // redirectUri ALWAYS comes from configLoader - no fallback, no database override
      const redirectUri = this.redirectUri;
      
      const response = await this.nylas.auth.exchangeCodeForToken({
        clientId: clientId,
        clientSecret: clientSecret,
        redirectUri: redirectUri,
        code: code
      });
      
      // Log the raw response to understand its structure
      console.log('Raw Nylas SDK response:', JSON.stringify(response, null, 2));
      
      // The Nylas Node.js SDK returns the grant_id directly in the response
      // Extract the grant ID - it might be in different places depending on the SDK version
      let grantId = response.grantId || response.grant_id || response.id;
      
      // If still no grant ID, check if response has a data property
      if (!grantId && response.data) {
        grantId = response.data.grant_id || response.data.grantId || response.data.id;
      }
      
      // Build a normalized grant object
      const grant = {
        grant_id: grantId,
        email: response.email || response.data?.email,
        provider: response.provider || response.data?.provider || 'google',
        // Include all response fields for debugging
        _raw_response: response
      };
      
      console.log('Processed grant object:', {
        grant_id: grant.grant_id,
        email: grant.email,
        provider: grant.provider
      });
      
      if (!grant.grant_id) {
        console.error('⚠️ WARNING: No grant ID found in response!');
        console.error('Full response structure:', JSON.stringify(response, null, 2));
      }
      
      return grant;
    } catch (error) {
      console.error('Error exchanging code for grant:', error);
      throw error;
    }
  }

  async getGrantInfo(grantId) {
    try {
      // For Nylas v3, we'll make a direct API call to verify the grant
      // Since the grant is already connected, we can test it by trying to get calendars
      const calendars = await this.nylas.calendars.list({
        identifier: grantId
      });
      
      // If we can successfully get calendars, the grant is valid
      if (calendars && calendars.data) {
        return {
          status: 'valid',
          grant_id: grantId,
          valid: true
        };
      }
      
      return {
        status: 'invalid',
        grant_id: grantId,
        valid: false
      };
    } catch (error) {
      console.error('Error getting grant info:', error);
      
      // Check for specific error codes
      if (error.status === 401 || error.status === 403) {
        return {
          status: 'invalid',
          grant_id: grantId,
          valid: false,
          error: 'Authentication failed'
        };
      }
      
      throw error;
    }
  }

  /**
   * Delete/revoke a grant from Nylas
   * @param {string} grantId - The Nylas grant ID to delete
   * @param {Object} accountCredentials - Optional account credentials for multi-account support
   * @returns {Promise<boolean>} Success status
   */
  async deleteGrant(grantId, accountCredentials = null) {
    try {
      // Use provided credentials or fall back to environment variables
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const region = accountCredentials?.region || this.region || 'us';
      const hostname = `api.${region}.nylas.com`;
      
      // Validate API key before making the request
      if (!apiKey) {
        const errorMsg = 'Cannot delete grant: No API key available';
        console.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const https = require('https');
      
      return await new Promise((resolve, reject) => {
        const options = {
          hostname: hostname,
          path: `/v3/grants/${grantId}`,
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        };

        console.log(`🗑️ Deleting grant ${grantId} from Nylas...`);
        console.log(`   Using API Key: ${apiKey.substring(0, 15)}...`);
        console.log(`   Account: ${accountCredentials ? 'custom' : 'default'}`);

        const req = https.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 204 || res.statusCode === 200) {
              console.log(`✅ Grant ${grantId} deleted successfully (${res.statusCode})`);
              resolve(true);
              return;
            }

            if (res.statusCode === 404) {
              console.log(`⚠️ Grant ${grantId} not found (already deleted)`);
              resolve(true); // Consider it deleted if not found
              return;
            }

            if (res.statusCode === 401 || res.statusCode === 403) {
              console.error(`❌ Authentication failed when deleting grant ${grantId}: ${res.statusCode}`);
              console.error(`Response: ${data}`);
              console.error(`Check NYLAS_CLIENT_ID and NYLAS_CLIENT_SECRET configuration`);
              reject(new Error(`Authentication failed: HTTP ${res.statusCode} - ${data}`));
              return;
            }

            console.error(`❌ Failed to delete grant ${grantId}: ${res.statusCode}`);
            console.error(`Response: ${data}`);
            reject(new Error(`Failed to delete grant: HTTP ${res.statusCode} - ${data}`));
          });
        });

        req.on('error', (error) => {
          console.error(`❌ Network error deleting grant:`, error.message);
          reject(new Error(`Network error: ${error.message}`));
        });

        req.end();
      });
    } catch (error) {
      console.error('Error deleting grant:', error);
      throw error;
    }
  }

  /**
   * Verify if a grant is still valid and active
   * @param {string} grantId - The Nylas grant ID to verify
   * @param {Object} accountCredentials - Optional account credentials for multi-account support
   * @returns {Object} Validation result with status and details
   */
  async verifyGrantStatus(grantId, accountCredentials = null) {
    try {
      const https = require('https');
      
      // Use provided credentials or fall back to environment variables
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const region = accountCredentials?.region || this.region || 'us';
      const hostname = `api.${region}.nylas.com`;
      
      console.log(`🔍 Verifying grant ${grantId} using account: ${accountCredentials ? 'custom' : 'default'}`);
      if (accountCredentials) {
        console.log(`   Using API key: ${apiKey.substring(0, 15)}...`);
        console.log(`   Region: ${region}`);
      }
      
      return await new Promise((resolve, reject) => {
        const options = {
          hostname: hostname,
          path: `/v3/grants/${grantId}`,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
          }
        };

        const req = https.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 404) {
              resolve({
                valid: false,
                status: 'not_found',
                message: 'Grant no longer exists in Nylas',
                requiresReconnection: true
              });
              return;
            }

            if (res.statusCode === 401 || res.statusCode === 403) {
              resolve({
                valid: false,
                status: 'unauthorized',
                message: 'Grant authentication failed',
                requiresReconnection: true
              });
              return;
            }

            if (res.statusCode !== 200) {
              resolve({
                valid: false,
                status: 'error',
                message: `Failed to verify grant: ${res.statusCode}`,
                requiresReconnection: true
              });
              return;
            }

            try {
              const response = JSON.parse(data);
              const grant = response.data || response;
              
              // Check grant status
              if (grant.grant_status !== 'valid') {
                resolve({
                  valid: false,
                  status: grant.grant_status,
                  message: `Grant status is ${grant.grant_status}`,
                  requiresReconnection: true,
                  grantInfo: {
                    email: grant.email,
                    provider: grant.provider
                  }
                });
                return;
              }

              // Grant is valid
              resolve({
                valid: true,
                status: 'valid',
                message: 'Grant is active and valid',
                grantInfo: {
                  email: grant.email,
                  provider: grant.provider,
                  scopes: grant.scope || []
                }
              });
            } catch (error) {
              resolve({
                valid: false,
                status: 'parse_error',
                message: `Failed to parse grant response: ${error.message}`,
                requiresReconnection: false
              });
            }
          });
        });

        req.on('error', (error) => {
          resolve({
            valid: false,
            status: 'network_error',
            message: `Network error: ${error.message}`,
            requiresReconnection: false
          });
        });

        req.end();
      });
    } catch (error) {
      console.error('Error verifying grant status:', error);
      return {
        valid: false,
        status: 'exception',
        message: error.message,
        requiresReconnection: false
      };
    }
  }

  // Calendar operations (v3)
  async getCalendars(grantId, accountCredentials = null) {
    try {
      // Get the appropriate Nylas SDK instance (custom or default)
      const nylasInstance = this.getNylasInstance(accountCredentials);
      
      const calendars = await nylasInstance.calendars.list({
        identifier: grantId
      });
      return calendars.data;
    } catch (error) {
      console.error('Error fetching calendars:', error);
      throw error;
    }
  }

  async createEvent(grantId, eventData, accountCredentials = null) {
    try {
      console.log('=== Nylas createEvent DEBUG ===');
      console.log('Event data received:', JSON.stringify(eventData, null, 2));
      console.log('Notetaker requested:', eventData.addNotetaker);
      console.log('Using account credentials:', accountCredentials ? 'custom account' : 'default account');
      
      // First, get the user's calendars to find the primary calendar
      const calendars = await this.getCalendars(grantId, accountCredentials);
      console.log('Available calendars:', calendars.map(cal => ({ id: cal.id, name: cal.name, isPrimary: cal.isPrimary })));
      
      // Find the primary calendar or use the first one
      const primaryCalendar = calendars.find(cal => cal.isPrimary) || calendars[0];
      if (!primaryCalendar) {
        throw new Error('No calendar available for this user');
      }
      
      console.log('Using calendar:', { id: primaryCalendar.id, name: primaryCalendar.name });
      
      // Prepare conferencing configuration based on Nylas v3 requirements
      let conferencingConfig = null;
      if (eventData.conferencing) {
        // Check if a meeting URL is already provided (for multi-candidate shared meetings)
        if (eventData.conferencing.details && eventData.conferencing.details.url) {
          // Don't autocreate - the meeting already exists
          // Nylas doesn't support adding existing meeting links directly in conferencing
          // So we'll skip the conferencing config and just include the link in the description
          conferencingConfig = null;
          console.log('Using existing meeting link:', eventData.conferencing.details.url);
        } else if (eventData.conferencing.provider === 'google_meet' || eventData.conferencing.provider === 'google') {
          // For Google Meet, use autocreate with settings to allow bots
          conferencingConfig = {
            provider: 'Google Meet',
            autocreate: {
              settings: {
                enable_join_before_host: true,
                enable_waiting_room: false,
                require_participant_approval: false
              }
            }
          };
        } else if (eventData.conferencing.provider === 'teams' || eventData.conferencing.provider === 'microsoft_teams' || eventData.conferencing.provider === 'microsoft') {
          // For Microsoft Teams, use autocreate to let Nylas generate the meeting link
          if (eventData.addNotetaker && !this._teamsAdminWarningLogged) {
            console.warn('[NYLAS][Teams] Microsoft Teams meetings require Microsoft 365 / Teams admin settings for the Notetaker bot to join reliably.');
            console.warn('[NYLAS][Teams] Verify these settings in Teams Admin Center:');
            console.warn('  - Allow participants to join before meeting organizer joins: ENABLED');
            console.warn('  - Waiting room: DISABLED (or bot allowlisted)');
            console.warn('  - Cloud recording: ENABLED');
            console.warn('  - Transcription: ENABLED');
            console.warn('[NYLAS][Teams] See docs/teams-admin-setup.md for the detailed checklist.');
            this._teamsAdminWarningLogged = true;
          }
          conferencingConfig = {
            provider: 'Microsoft Teams',
            autocreate: {}
          };
        } else {
          // For other providers or unknown providers, default to Google Meet with bot-friendly settings
          console.warn(`Unknown conferencing provider: ${eventData.conferencing.provider}, defaulting to Google Meet`);
          conferencingConfig = {
            provider: 'Google Meet',
            autocreate: {
              settings: {
                enable_join_before_host: true,
                enable_waiting_room: false,
                require_participant_approval: false
              }
            }
          };
        }
      } else {
        // If no conferencing specified, default to Google Meet with bot-friendly settings
        console.log('No conferencing specified, defaulting to Google Meet with bot-friendly settings');
        conferencingConfig = {
          provider: 'Google Meet',
          autocreate: {
            settings: {
              enable_join_before_host: true,
              enable_waiting_room: false,
              require_participant_approval: false
            }
          }
        };
      }
      
      // Parse and validate times
      const startDate = new Date(eventData.startTime);
      const endDate = new Date(eventData.endTime);
      
      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error(`Invalid date format. Start: ${eventData.startTime}, End: ${eventData.endTime}`);
      }
      
      if (endDate <= startDate) {
        throw new Error(`End time (${eventData.endTime}) must be after start time (${eventData.startTime})`);
      }
      
      const dedupedParticipantsMap = new Map();

      const normalizedParticipants = (eventData.participants || []).filter(participant => {
        // EXCLUDE BCC participants from the main calendar event to keep them hidden
        // BCC participants should not appear in the guest list
        return participant.visibility !== 'bcc';
      }).map(participant => {
        const participantData = {
          email: participant.email,
          name: participant.name
        };

        // Always request RSVP from attendees so calendar providers dispatch invitations consistently.
        participantData.status = 'noreply';
        if (participant.visibility === 'cc') {
          participantData.comment = 'CC';
        }

        return participantData;
      });

      for (const participant of normalizedParticipants) {
        if (!participant?.email) {
          continue;
        }

        const key = String(participant.email).toLowerCase().trim();
        if (!key) {
          continue;
        }

        const existing = dedupedParticipantsMap.get(key);
        if (!existing) {
          dedupedParticipantsMap.set(key, {
            email: participant.email,
            name: participant.name || participant.email,
            status: participant.status || 'noreply',
            ...(participant.comment ? { comment: participant.comment } : {})
          });
          continue;
        }

        if ((!existing.name || existing.name === existing.email) && participant.name) {
          existing.name = participant.name;
        }

        if (!existing.comment && participant.comment) {
          existing.comment = participant.comment;
        }

        dedupedParticipantsMap.set(key, existing);
      }

      if (normalizedParticipants.length !== dedupedParticipantsMap.size) {
        console.warn(
          `⚠️ Deduped calendar participants from ${normalizedParticipants.length} to ${dedupedParticipantsMap.size}`
        );
      }

      const requestBody = {
        title: eventData.title,
        description: eventData.description,
        when: {
          startTime: Math.floor(startDate.getTime() / 1000),
          endTime: Math.floor(endDate.getTime() / 1000)
        },
        participants: Array.from(dedupedParticipantsMap.values())
      };
      
      // Only add conferencing if it's configured
      if (conferencingConfig) {
        requestBody.conferencing = conferencingConfig;
        
        // For Google Meet with autocreate, don't set location as it conflicts with autocreation
        // For other providers or in-person meetings, include the location
        if (conferencingConfig.provider !== 'Google Meet' || !conferencingConfig.autocreate) {
          requestBody.location = eventData.location;
        }
      } else {
        // If no conferencing, always include location
        requestBody.location = eventData.location;
      }
      
      console.log('Final request body:', JSON.stringify(requestBody, null, 2));
      console.log('Time validation:', {
        startTimeUnix: requestBody.when.startTime,
        endTimeUnix: requestBody.when.endTime,
        startTimeHuman: new Date(requestBody.when.startTime * 1000).toISOString(),
        endTimeHuman: new Date(requestBody.when.endTime * 1000).toISOString(),
        durationMinutes: (requestBody.when.endTime - requestBody.when.startTime) / 60
      });
      
      // Get the appropriate Nylas SDK instance (custom or default)
      const nylasInstance = this.getNylasInstance(accountCredentials);
      
      const shouldNotifyParticipants = eventData.notifyParticipants !== false;
      const event = await nylasInstance.events.create({
        identifier: grantId,
        requestBody: requestBody,
        queryParams: {
          calendarId: primaryCalendar.id,
          notifyParticipants: shouldNotifyParticipants
        }
      });
      console.log('Event notifyParticipants:', shouldNotifyParticipants);
      
      console.log('Event created successfully:', JSON.stringify(event.data, null, 2));

      // Calendar invite fallback should only run when Nylas participant notifications
      // are not being used, unless explicitly forced for diagnostics.
      const forceBrevoCalendarFallback =
        eventData?.forceBrevoCalendarInviteFallback === true ||
        process.env.FORCE_BREVO_CALENDAR_INVITE_FALLBACK === 'true';

      if (!shouldNotifyParticipants || forceBrevoCalendarFallback) {
        await this.sendBrevoCalendarInviteFallback(event.data, requestBody, eventData);
      } else if (process.env.ENABLE_BREVO_CALENDAR_INVITE_FALLBACK === 'true') {
        console.log('📅 [Calendar Fallback] Skipped: Nylas notifyParticipants=true already requested participant invites');
      }
      
      // Enable notetaker if requested
      if (eventData.addNotetaker && !eventData.skipServiceNotetaker && event.data.id) {
        try {
          console.log('Attempting to enable notetaker for event:', event.data.id);
          console.log('Event conferencing data:', event.data.conferencing);
          
          // Get the meeting URL from conferencing details
          const meetingUrl = event.data.conferencing?.details?.url || 
                           event.data.conferencing?.details?.meeting_url ||
                           event.data.conferencing?.join_url;
          
          if (meetingUrl) {
            console.log('Using meeting URL:', meetingUrl);
            // Calculate join time as event start time
            const joinTime = new Date(eventData.startTime);
            const notetakerResult = await this.createStandaloneNotetaker(
              meetingUrl,
              {
                name: "SmartHR Notetaker Bot",
                videoRecording: true,
                audioRecording: true,
                transcription: true,
                summary: true
              },
              joinTime,
              accountCredentials
            );
            console.log('Notetaker enabled successfully:', notetakerResult);
            
            // Add notetaker info to the event response
            event.data.notetaker = {
              enabled: true,
              status: 'enabled',
              notetakerId: notetakerResult.notetakerId,
              ...notetakerResult
            };
          } else {
            console.warn('No meeting URL found in conferencing details, cannot enable notetaker');
            event.data.notetaker = {
              enabled: false,
              status: 'failed',
              error: 'No meeting URL available - conferencing must be enabled'
            };
          }
        } catch (notetakerError) {
          console.error('Failed to enable notetaker:', notetakerError);
          // Don't fail the event creation if notetaker fails
          event.data.notetaker = {
            enabled: false,
            status: 'failed',
            error: notetakerError.message
          };
        }
      }
      
      return event.data;
    } catch (error) {
      console.error('Error creating event:', error);
      throw error;
    }
  }

  /**
   * Send calendar invites to BCC participants separately
   * This ensures BCC recipients get the calendar invite without appearing in the main event's guest list
   * @param {string} grantId - Nylas grant ID
   * @param {Object} eventData - Event data from the main calendar event
   * @param {Array} bccParticipants - Array of BCC participants {email, name, visibility: 'bcc'}
   * @returns {Promise<Object>} Results of sending BCC invites
   */
  async sendBccCalendarInvites(grantId, eventData, bccParticipants, accountCredentials = null) {
    try {
      if (!bccParticipants || bccParticipants.length === 0) {
        return { success: true, message: 'No BCC participants to send to', sent: 0 };
      }

      console.log(`📅 Sending separate calendar invites to ${bccParticipants.length} BCC recipients`);
      
      const mainParticipantEmails = new Set(
        (eventData?.participants || [])
          .map(participant => String(participant?.email || '').trim().toLowerCase())
          .filter(Boolean)
      );

      const organizerEmail = String(eventData?.organizer?.email || '').trim().toLowerCase();
      if (organizerEmail) {
        mainParticipantEmails.add(organizerEmail);
      }

      const uniqueBccMap = new Map();
      for (const participant of bccParticipants) {
        const email = String(participant?.email || '').trim().toLowerCase();
        if (!email) {
          continue;
        }

        if (mainParticipantEmails.has(email)) {
          console.log(`📅 Skipping BCC calendar invite for ${email} (already included in main participants)`);
          continue;
        }

        if (!uniqueBccMap.has(email)) {
          uniqueBccMap.set(email, {
            ...participant,
            email
          });
        }
      }

      const filteredBccParticipants = Array.from(uniqueBccMap.values());
      if (filteredBccParticipants.length === 0) {
        return {
          success: true,
          message: 'No unique BCC participants after dedupe against main recipients',
          sent: 0
        };
      }

      const results = [];
      
      // Send individual calendar invites to each BCC participant
      for (const bccParticipant of filteredBccParticipants) {
        try {
          // Create a separate calendar event that includes only the BCC recipient
          // This way they get a proper calendar invite but don't see other participants
          const bccEventData = {
            ...eventData,
            participants: [
              {
                email: bccParticipant.email,
                name: bccParticipant.name,
                status: 'noreply'
              }
            ]
          };
          
          // Keep the original title and description
          // BCC recipients should get a natural-looking calendar invite identical to the main event

          const bccEvent = await this.createEvent(grantId, bccEventData, accountCredentials);
          
          results.push({
            participant: bccParticipant.email,
            success: true,
            eventId: bccEvent.id
          });
          
          console.log(`✅ BCC calendar invite sent to ${bccParticipant.email}`);
          
        } catch (error) {
          console.error(`❌ Failed to send BCC calendar invite to ${bccParticipant.email}:`, error.message);
          results.push({
            participant: bccParticipant.email,
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;
      
      return {
        success: failureCount === 0,
        message: `BCC calendar invites: ${successCount} sent, ${failureCount} failed`,
        sent: successCount,
        failed: failureCount,
        results: results
      };
      
    } catch (error) {
      console.error('❌ Error sending BCC calendar invites:', error.message);
      throw error;
    }
  }

  // Standalone notetaker methods - NO grant required (NEW API)
  async createStandaloneNotetaker(meetingLink, options = {}, joinTime = null, accountCredentials = null) {
    try {
      console.log('=== CREATING STANDALONE NOTETAKER ===');
      console.log('Meeting link:', meetingLink);
      console.log('Join time:', joinTime);
      console.log('Using account credentials:', !!accountCredentials);

      // Use provided credentials or fall back to default
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const apiUri = accountCredentials?.apiUri || this.apiUri;

      console.log('Using API key present:', !!apiKey);
      console.log('Using API URI:', apiUri);

      if (!apiKey) {
        throw new Error('NYLAS_API_KEY is required to create a standalone notetaker');
      }

      // Validate meeting link format
      if (!meetingLink || typeof meetingLink !== 'string') {
        throw new Error('Invalid meeting link provided');
      }

      // Check if it's a supported meeting platform
      const supportedPlatforms = [
        'meet.google.com',
        'teams.microsoft.com',
        'zoom.us'
      ];

      const isSupported = supportedPlatforms.some(platform => meetingLink.includes(platform));
      if (!isSupported) {
        console.warn(`Meeting link may not be supported: ${meetingLink}`);
        console.warn('Supported platforms:', supportedPlatforms.join(', '));
      }

      const requestBody = {
        meeting_link: meetingLink,
        name: options.name || "SmartHR Notetaker Bot",
        meeting_settings: {
          video_recording: options.videoRecording ?? true,
          audio_recording: options.audioRecording ?? true,
          transcription: options.transcription ?? true,
          summary: options.summary ?? true,
          action_items: options.actionItems ?? false,
          leave_after_silence_seconds: options.leaveAfterSilenceSeconds || 300
        }
      };

      if (joinTime) {
        const joinTimeUnix = Math.floor(new Date(joinTime).getTime() / 1000);
        requestBody.join_time = joinTimeUnix;
      }

      const response = await fetch(`${apiUri}/v3/notetakers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json, application/gzip'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const error = await response.text();

        if (response.status === 403) {
          throw new Error('NOTETAKER_FEATURE_DISABLED: Notetaker feature is not enabled for your Nylas account. Please contact Nylas support.');
        }
        if (response.status === 400 && error.includes('meeting_link')) {
          throw new Error('INVALID_MEETING_LINK: Invalid meeting link. Notetaker supports Google Meet, Microsoft Teams, and Zoom. Ensure the meeting allows external participants.');
        }
        if (response.status === 401) {
          throw new Error('AUTHENTICATION_ERROR: Invalid API key.');
        }

        throw new Error(`NOTETAKER_CREATION_FAILED: ${error} (Status: ${response.status})`);
      }

      const result = await response.json();
      const notetakerData = result.data || result;
      const notetakerId =
        notetakerData.id ||
        notetakerData.notetaker_id ||
        result.notetaker_id ||
        result.id;

      if (!notetakerId) {
        console.error('No notetaker ID found in response:', result);
        throw new Error('Notetaker was created but no ID was returned');
      }

      return {
        ...notetakerData,
        notetakerId: notetakerId,
        id: notetakerId,
        rawResponse: result
      };
    } catch (error) {
      console.error('Error creating standalone notetaker:', error);
      throw error;
    }
  }

  async getStandaloneNotetakerStatus(notetakerId, accountCredentials = null) {
    try {
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const apiUri = accountCredentials?.apiUri || this.apiUri;

      const response = await fetch(`${apiUri}/v3/notetakers/${notetakerId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json, application/gzip'
        }
      });

      if (!response.ok) {
        const error = await response.text();

        if (response.status === 404) {
          throw new Error(`NOTETAKER_NOT_FOUND: The notetaker with ID ${notetakerId} was not found. This may happen if the notetaker was automatically cleaned up due to inactivity, timeout, or failed to join the meeting.`);
        }

        throw new Error(`Failed to get standalone notetaker status: ${error}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting standalone notetaker status:', error);
      throw error;
    }
  }

  async cancelStandaloneNotetaker(notetakerId, accountCredentials = null) {
    try {
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const apiUri = accountCredentials?.apiUri || this.apiUri;

      const response = await fetch(`${apiUri}/v3/notetakers/${notetakerId}/cancel`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to cancel standalone notetaker: ${error}`);
      }

      if (response.status === 204) {
        return { success: true, message: 'Notetaker cancelled successfully' };
      }

      return await response.json();
    } catch (error) {
      console.error('Error cancelling standalone notetaker:', error);
      throw error;
    }
  }

  async leaveStandaloneNotetaker(notetakerId, accountCredentials = null) {
    try {
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const apiUri = accountCredentials?.apiUri || this.apiUri;

      const response = await fetch(`${apiUri}/v3/notetakers/${notetakerId}/leave`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json, application/gzip'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }

        if (errorData.error?.message?.includes('not in meeting')) {
          throw new Error('NOTETAKER_NOT_IN_MEETING');
        }

        throw new Error(`Failed to make standalone notetaker leave: ${errorData.error?.message || errorText}`);
      }

      return { success: true, message: 'Notetaker removed from meeting' };
    } catch (error) {
      console.error('Error making standalone notetaker leave:', error);
      throw error;
    }
  }

  async getStandaloneNotetakerMedia(notetakerId, accountCredentials = null) {
    try {
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const apiUri = accountCredentials?.apiUri || this.apiUri;

      const response = await fetch(`${apiUri}/v3/notetakers/${notetakerId}/media`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json, application/gzip'
        }
      });

      if (!response.ok) {
        const error = await response.text();
        if (response.status === 404) {
          throw new Error('Media not available yet. Files may still be processing.');
        }
        throw new Error(`Failed to get standalone notetaker media: ${error}`);
      }

      const result = await response.json();
      return {
        recording: result.data?.recording,
        transcript: result.data?.transcript
      };
    } catch (error) {
      console.error('Error getting standalone notetaker media:', error);
      throw error;
    }
  }

  async getStandaloneTranscript(notetakerId, accountCredentials = null) {
    try {
      const media = await this.getStandaloneNotetakerMedia(notetakerId, accountCredentials);

      if (!media.transcript || !media.transcript.url) {
        throw new Error('Transcript not available yet');
      }

      const transcriptResponse = await fetch(media.transcript.url);
      if (!transcriptResponse.ok) {
        throw new Error('Failed to download transcript');
      }

      const transcriptText = await transcriptResponse.text();
      return {
        content: transcriptText,
        size: media.transcript.size,
        url: media.transcript.url
      };
    } catch (error) {
      console.error('Error getting standalone transcript:', error);
      throw error;
    }
  }

  async updateEvent(grantId, eventId, eventData, accountCredentials = null) {
    try {
      // Use direct API call if custom credentials provided
      if (accountCredentials) {
        const https = require('https');
        const apiKey = accountCredentials.apiKey;
        const region = accountCredentials.region || 'us';
        const hostname = `api.${region}.nylas.com`;
        
        return await new Promise((resolve, reject) => {
          const postData = JSON.stringify(eventData);
          
          const options = {
            hostname: hostname,
            path: `/v3/grants/${grantId}/events/${eventId}`,
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };
          
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              if (res.statusCode === 200) {
                const response = JSON.parse(data);
                resolve(response.data || response);
              } else {
                reject(new Error(`Failed to update event: ${res.statusCode}`));
              }
            });
          });
          
          req.on('error', reject);
          req.write(postData);
          req.end();
        });
      }
      
      // Default SDK behavior
      const event = await this.nylas.events.update({
        identifier: grantId,
        eventId: eventId,
        requestBody: eventData
      });
      return event.data;
    } catch (error) {
      console.error('Error updating event:', error);
      throw error;
    }
  }

  async deleteEvent(grantId, eventId, accountCredentials = null) {
    try {
      console.log('=== DELETING CALENDAR EVENT ===');
      console.log('Grant ID:', grantId);
      console.log('Event ID:', eventId);
      console.log('Using account credentials:', accountCredentials ? 'custom account' : 'default account');
      
      // Get the appropriate Nylas SDK instance (custom or default)
      const nylasInstance = this.getNylasInstance(accountCredentials);
      
      const result = await nylasInstance.events.destroy({
        identifier: grantId,
        eventId: eventId
      });
      
      console.log('✅ Event deletion successful');
      console.log('Result:', result);
      return true;
    } catch (error) {
      console.error('❌ Error deleting event:', error.message || error);
      console.error('Full error:', error);
      throw error;
    }
  }

  // Check for conflicts by getting existing events in the time range
  async getAvailability(grantId, startTime, endTime, participantEmails = [], accountCredentials = null) {
    try {
      console.log('=== Nylas Conflict Check DEBUG ===');
      console.log('Grant ID:', grantId);
      console.log('Start Time:', startTime, '(timestamp:', Math.floor(new Date(startTime).getTime() / 1000), ')');
      console.log('End Time:', endTime, '(timestamp:', Math.floor(new Date(endTime).getTime() / 1000), ')');
      console.log('Participant Emails:', participantEmails);
      
      // Filter out any undefined/null emails
      const validEmails = participantEmails.filter(email => email && typeof email === 'string' && email.trim().length > 0);
      console.log('Valid Emails:', validEmails);
      
      if (validEmails.length === 0) {
        console.warn('No valid participant emails provided, skipping conflict check');
        return { timeSlots: [] }; // Return no conflicts
      }
      
      // Instead of using the problematic availability API, get existing events
      // and check for conflicts manually
      const requestedStart = new Date(startTime);
      const requestedEnd = new Date(endTime);
      
      // Expand the search range to catch events that might overlap
      const searchStart = new Date(requestedStart.getTime() - (2 * 60 * 60 * 1000)); // 2 hours before
      const searchEnd = new Date(requestedEnd.getTime() + (2 * 60 * 60 * 1000)); // 2 hours after
      
      console.log('Searching for existing events from:', searchStart.toISOString(), 'to:', searchEnd.toISOString());
      
      const events = await this.getEvents(grantId, searchStart.toISOString(), searchEnd.toISOString(), accountCredentials);
      console.log('Found', events.length, 'existing events in time range');
      
      // Check for conflicts with existing events
      const conflicts = [];
      
      for (const event of events) {
        if (!event.when || !event.when.startTime || !event.when.endTime) {
          continue; // Skip events without proper time data
        }
        
        // Convert event times from Unix timestamps to Date objects
        const eventStart = new Date(event.when.startTime * 1000);
        const eventEnd = new Date(event.when.endTime * 1000);
        
        console.log('Checking event:', event.title);
        console.log('  Event time:', eventStart.toISOString(), 'to', eventEnd.toISOString());
        console.log('  Requested time:', requestedStart.toISOString(), 'to', requestedEnd.toISOString());
        
        // Check for overlap: events overlap if one starts before the other ends
        const hasOverlap = (requestedStart < eventEnd) && (requestedEnd > eventStart);
        
        console.log('  Has overlap?', hasOverlap);
        
        if (hasOverlap) {
          conflicts.push({
            emails: validEmails,
            startTime: Math.floor(eventStart.getTime() / 1000),
            endTime: Math.floor(eventEnd.getTime() / 1000),
            eventTitle: event.title,
            eventId: event.id
          });
          console.log('  CONFLICT DETECTED with event:', event.title);
        }
      }
      
      console.log('Total conflicts found:', conflicts.length);
      
      // Return in the expected format
      return {
        order: validEmails,
        timeSlots: conflicts
      };
      
    } catch (error) {
      console.error('Error checking for conflicts:', error);
      // If we can't check for conflicts, assume no conflicts (fail open)
      return { timeSlots: [] };
    }
  }

  // Get events for a date range
  async getEvents(grantId, startDate, endDate, accountCredentials = null) {
    try {
      // Get the user's calendars to find the primary calendar
      const calendars = await this.getCalendars(grantId, accountCredentials);
      const primaryCalendar = calendars.find(cal => cal.isPrimary) || calendars[0];
      
      if (!primaryCalendar) {
        console.warn('No calendar available for events lookup');
        return [];
      }
      
      // Use direct API call if custom credentials provided
      if (accountCredentials) {
        const https = require('https');
        const apiKey = accountCredentials.apiKey;
        const region = accountCredentials.region || 'us';
        const hostname = `api.${region}.nylas.com`;
        
        const queryParams = new URLSearchParams({
          calendar_id: primaryCalendar.id,
          start: Math.floor(new Date(startDate).getTime() / 1000).toString(),
          end: Math.floor(new Date(endDate).getTime() / 1000).toString()
        });
        
        return await new Promise((resolve, reject) => {
          const options = {
            hostname: hostname,
            path: `/v3/grants/${grantId}/events?${queryParams}`,
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Accept': 'application/json'
            }
          };
          
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              if (res.statusCode === 200) {
                const response = JSON.parse(data);
                resolve(response.data || response);
              } else {
                reject(new Error(`Failed to fetch events: ${res.statusCode}`));
              }
            });
          });
          
          req.on('error', reject);
          req.end();
        });
      }
      
      // Default SDK behavior
      const events = await this.nylas.events.list({
        identifier: grantId,
        queryParams: {
          calendarId: primaryCalendar.id,
          start: Math.floor(new Date(startDate).getTime() / 1000),
          end: Math.floor(new Date(endDate).getTime() / 1000)
        }
      });
      return events.data;
    } catch (error) {
      console.error('Error fetching events:', error);
      throw error;
    }
  }

  // Get a specific event by ID
  async getEvent(grantId, eventId, accountCredentials = null) {
    try {
      console.log(`📅 [GET-EVENT] Fetching event ${eventId} for grant ${grantId}`);
      
      // Use direct API call if custom credentials provided
      if (accountCredentials) {
        const https = require('https');
        const apiKey = accountCredentials.apiKey;
        const region = accountCredentials.region || 'us';
        const hostname = `api.${region}.nylas.com`;
        
        return await new Promise((resolve, reject) => {
          const options = {
            hostname: hostname,
            path: `/v3/grants/${grantId}/events/${eventId}`,
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Accept': 'application/json'
            }
          };
          
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              if (res.statusCode === 200) {
                const response = JSON.parse(data);
                resolve(response.data || response);
              } else if (res.statusCode === 404) {
                resolve(null);
              } else {
                reject(new Error(`Failed to fetch event: ${res.statusCode}`));
              }
            });
          });
          
          req.on('error', reject);
          req.end();
        });
      }
      
      // Default SDK behavior
      const event = await this.nylas.events.find({
        identifier: grantId,
        eventId: eventId
      });
      
      console.log(`✅ [GET-EVENT] Found event: ${event.data?.title}, participants: ${event.data?.participants?.length || 0}`);
      return event.data;
    } catch (error) {
      if (error.status === 404) {
        console.warn(`⚠️ [GET-EVENT] Event ${eventId} not found for grant ${grantId}`);
        return null;
      }
      console.error(`❌ [GET-EVENT] Error fetching event ${eventId}:`, error);
      throw error;
    }
  }

  // Scheduler v3 operations
  async createSchedulingPage(data) {
    try {
      const schedulingPage = await this.nylas.scheduler.configurations.create({
        requestBody: {
          name: data.name,
          slug: data.slug,
          participants: [{
            email: data.hostEmail,
            name: data.hostName,
            availability: data.availability,
            timezone: data.timezone
          }],
          availability: {
            durationMinutes: data.duration || 60,
            intervalMinutes: data.interval || 30
          },
          eventBooking: {
            title: data.title,
            description: data.description,
            location: data.location,
            conferencing: data.conferencing
          }
        }
      });
      return schedulingPage.data;
    } catch (error) {
      console.error('Error creating scheduling page:', error);
      throw error;
    }
  }

  async bookMeeting(configurationId, bookingData) {
    try {
      const booking = await this.nylas.scheduler.bookings.create({
        configurationId: configurationId,
        requestBody: {
          startTime: Math.floor(new Date(bookingData.startTime).getTime() / 1000),
          endTime: Math.floor(new Date(bookingData.endTime).getTime() / 1000),
          guest: {
            name: bookingData.guestName,
            email: bookingData.guestEmail
          },
          timezone: bookingData.timezone
        }
      });
      return booking.data;
    } catch (error) {
      console.error('Error booking meeting:', error);
      throw error;
    }
  }

  // Webhook event handlers
  async handleEventCreated(data) {
    console.log('Event created:', data);
    // Update local database with new event
  }

  async handleEventUpdated(data) {
    console.log('Event updated:', data);
    // Update local database with event changes
  }

  async handleEventDeleted(data) {
    console.log('Event deleted:', data);
    // Update local database to reflect deletion
  }

  async handleBookingCreated(data) {
    console.log('Booking created:', data);
    // Handle new scheduler booking
  }
}

module.exports = new NylasV3Service(); 

const Nylas = require('nylas').default;
const configLoader = require('../config/configLoader');

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
      
      const requestBody = {
        title: eventData.title,
        description: eventData.description,
        when: {
          startTime: Math.floor(startDate.getTime() / 1000),
          endTime: Math.floor(endDate.getTime() / 1000)
        },
        participants: (eventData.participants || []).filter(participant => {
          // EXCLUDE BCC participants from the main calendar event to keep them hidden
          // BCC participants should not appear in the guest list
          return participant.visibility !== 'bcc';
        }).map(participant => {
          // Handle CC visibility for calendar invites
          const participantData = {
            email: participant.email,
            name: participant.name
          };
          
          // Set participant status based on visibility
          if (participant.visibility === 'cc') {
            participantData.status = 'noreply'; 
            participantData.comment = 'CC';
          } else {
            participantData.status = participant.status || 'noreply';
          }
          
          return participantData;
        })
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
      
      const event = await nylasInstance.events.create({
        identifier: grantId,
        requestBody: requestBody,
        queryParams: {
          calendarId: primaryCalendar.id
        }
      });
      
      console.log('Event created successfully:', JSON.stringify(event.data, null, 2));
      
      // Enable notetaker if requested
      if (eventData.addNotetaker && event.data.id) {
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
            const notetakerResult = await this.enableNotetakerForEvent(grantId, event.data.id, meetingUrl, joinTime, accountCredentials);
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
  async sendBccCalendarInvites(grantId, eventData, bccParticipants) {
    try {
      if (!bccParticipants || bccParticipants.length === 0) {
        return { success: true, message: 'No BCC participants to send to', sent: 0 };
      }

      console.log(`📅 Sending separate calendar invites to ${bccParticipants.length} BCC recipients`);
      
      const results = [];
      
      // Send individual calendar invites to each BCC participant
      for (const bccParticipant of bccParticipants) {
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

          const bccEvent = await this.createEvent(grantId, bccEventData);
          
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

  // Notetaker methods - Using official Nylas v3 API
  async enableNotetakerForEvent(grantId, eventId, meetingLink, joinTime = null, accountCredentials = null) {
    try {
      console.log('=== ENABLING NOTETAKER ===');
      console.log('Event ID:', eventId);
      console.log('Meeting link:', meetingLink);
      console.log('Join time:', joinTime);
      console.log('Using account credentials:', !!accountCredentials);
      
      // Use provided credentials or fall back to default
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const apiUri = accountCredentials?.apiUri || this.apiUri;
      
      console.log('📤 Using API Key:', apiKey ? apiKey.substring(0, 15) + '...' : 'none');
      console.log('📤 Using API URI:', apiUri);
      
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
        console.warn(`⚠️ Meeting link may not be supported: ${meetingLink}`);
        console.warn('Supported platforms:', supportedPlatforms.join(', '));
      }
      
      // Build request body according to official docs
      const requestBody = {
        meeting_link: meetingLink,
        name: "SmartHR Notetaker Bot",
        meeting_settings: {
          video_recording: true,
          audio_recording: true,
          transcription: true
        }
      };
      
      // Add join_time if provided (for scheduled joining)
      if (joinTime) {
        const joinTimeUnix = Math.floor(new Date(joinTime).getTime() / 1000);
        requestBody.join_time = joinTimeUnix;
        console.log('⏰ Setting notetaker join_time:', {
          original: joinTime,
          unix: joinTimeUnix,
          humanReadable: new Date(joinTimeUnix * 1000).toISOString(),
          minutesFromNow: Math.round((joinTimeUnix * 1000 - Date.now()) / 60000)
        });
      } else {
        console.log('⏰ No join_time set - bot will join immediately when meeting starts');
      }
      
      console.log('📤 Nylas API request body:', JSON.stringify(requestBody, null, 2));
      
      // Use grant-specific endpoint for better association
      const response = await fetch(`${apiUri}/v3/grants/${grantId}/notetakers`, {
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
        console.error('❌ Failed to enable notetaker:', {
          status: response.status,
          statusText: response.statusText,
          error: error,
          meetingLink: meetingLink,
          grantId: grantId
        });
        
        // Check common error scenarios with detailed messages
        if (response.status === 403) {
          throw new Error('NOTETAKER_FEATURE_DISABLED: Notetaker feature is not enabled for your Nylas account. Please contact Nylas support.');
        }
        if (response.status === 400 && error.includes('meeting_link')) {
          throw new Error('INVALID_MEETING_LINK: Invalid meeting link. Notetaker supports Google Meet, Microsoft Teams, and Zoom. Ensure the meeting allows external participants.');
        }
        if (response.status === 400 && error.includes('grant')) {
          throw new Error('GRANT_PERMISSION_ERROR: The calendar grant does not have sufficient permissions for notetaker access.');
        }
        if (response.status === 401) {
          throw new Error('AUTHENTICATION_ERROR: Invalid API key or grant permissions.');
        }
        
        throw new Error(`NOTETAKER_CREATION_FAILED: ${error} (Status: ${response.status})`);
      }

      const result = await response.json();
      console.log('✅ Notetaker created successfully');
      console.log('📥 Raw Nylas response structure:', JSON.stringify(result, null, 2));
      
      // Extract the notetaker ID - check both possible locations
      const notetakerId = result.data?.notetaker_id || result.notetaker_id || result.data?.id || result.id;
      console.log('🆔 Extracted notetaker ID:', notetakerId);
      
      // Log important notetaker details
      if (result.data) {
        console.log('📊 Notetaker details:', {
          id: result.data.id,
          state: result.data.state,
          meeting_state: result.data.meeting_state,
          join_time: result.data.join_time,
          join_time_human: result.data.join_time ? new Date(result.data.join_time * 1000).toISOString() : 'N/A',
          meeting_link: result.data.meeting_link
        });
      }
      
      if (!notetakerId) {
        console.error('No notetaker ID found in response:', result);
        throw new Error('Notetaker was created but no ID was returned');
      }
      
      // Return the notetaker ID from the response
      return {
        notetakerId: notetakerId,
        rawResponse: result,
        ...result.data
      };
    } catch (error) {
      console.error('Error enabling notetaker:', error);
      throw error;
    }
  }

  // Get notetaker status
  async getNotetakerStatus(grantId, notetakerId, accountCredentials = null) {
    try {
      // Use provided credentials or fall back to environment variables
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const region = accountCredentials?.region || this.region || 'us';
      const apiUri = accountCredentials?.apiUri || this.apiUri;
      
      // Can use either endpoint according to docs
      const response = await fetch(`${apiUri}/v3/grants/${grantId}/notetakers/${notetakerId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json, application/gzip'
        }
      });

      if (!response.ok) {
        const error = await response.text();
        
        // Handle specific 404 case - notetaker not found
        if (response.status === 404) {
          throw new Error(`NOTETAKER_NOT_FOUND: The notetaker with ID ${notetakerId} was not found. This may happen if the notetaker was automatically cleaned up due to inactivity, timeout, or failed to join the meeting.`);
        }
        
        throw new Error(`Failed to get notetaker status: ${error}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting notetaker status:', error);
      throw error;
    }
  }

  // Get list of notetakers
  async getNotetakers(grantId, accountCredentials = null) {
    try {
      // Use provided credentials or fall back to environment variables
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const region = accountCredentials?.region || this.region || 'us';
      const apiUri = accountCredentials?.apiUri || this.apiUri;
      
      const response = await fetch(`${apiUri}/v3/grants/${grantId}/notetakers`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json, application/gzip'
        }
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get notetakers: ${error}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting notetakers:', error);
      throw error;
    }
  }

  // Get notetaker media (recording and transcript)
  async getNotetakerMedia(grantId, notetakerId, accountCredentials = null) {
    try {
      // Use provided credentials or fall back to environment variables
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const region = accountCredentials?.region || this.region || 'us';
      const apiUri = accountCredentials?.apiUri || this.apiUri;
      
      const response = await fetch(`${apiUri}/v3/grants/${grantId}/notetakers/${notetakerId}/media`, {
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
        throw new Error(`Failed to get notetaker media: ${error}`);
      }

      const result = await response.json();
      // Media URLs are valid for up to 1 hour
      return {
        recording: result.data?.recording,
        transcript: result.data?.transcript
      };
    } catch (error) {
      console.error('Error getting notetaker media:', error);
      throw error;
    }
  }

  // Cancel a scheduled notetaker
  async cancelNotetaker(grantId, notetakerId, accountCredentials = null) {
    try {
      // Use provided credentials or fall back to environment variables
      const apiKey = accountCredentials?.apiKey || this.apiKey;
      const region = accountCredentials?.region || this.region || 'us';
      const apiUri = accountCredentials?.apiUri || this.apiUri;
      
      const response = await fetch(`${apiUri}/v3/grants/${grantId}/notetakers/${notetakerId}/cancel`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to cancel notetaker: ${error}`);
      }

      // DELETE request may return 204 No Content
      if (response.status === 204) {
        return { success: true, message: 'Notetaker cancelled successfully' };
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error cancelling notetaker:', error);
      throw error;
    }
  }

  // Remove notetaker from active meeting
  async removeNotetakerFromMeeting(grantId, notetakerId) {
    try {
      const response = await fetch(`${this.apiUri}/v3/grants/${grantId}/notetakers/${notetakerId}/leave`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
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
        
        // Check for specific error cases
        if (errorData.error?.message?.includes('not in meeting')) {
          throw new Error('NOTETAKER_NOT_IN_MEETING');
        }
        
        throw new Error(`Failed to remove notetaker: ${errorData.error?.message || errorText}`);
      }

      return { success: true, message: 'Notetaker removed from meeting' };
    } catch (error) {
      console.error('Error removing notetaker:', error);
      throw error;
    }
  }

  // Download transcript content
  async getTranscript(grantId, notetakerId, accountCredentials = null) {
    try {
      // First get the media URLs
      const media = await this.getNotetakerMedia(grantId, notetakerId, accountCredentials);
      
      if (!media.transcript || !media.transcript.url) {
        throw new Error('Transcript not available yet');
      }

      // Download the transcript content
      const transcriptResponse = await fetch(media.transcript.url);

      if (!transcriptResponse.ok) {
        throw new Error('Failed to download transcript');
      }

      // The transcript is returned as text/plain
      const transcriptText = await transcriptResponse.text();
      
      return {
        content: transcriptText,
        size: media.transcript.size,
        url: media.transcript.url
      };
    } catch (error) {
      console.error('Error getting transcript:', error);
      throw error;
    }
  }

  // Legacy methods for backward compatibility
  async disableNotetakerForEvent(grantId, notetakerId) {
    return this.cancelNotetaker(grantId, notetakerId);
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
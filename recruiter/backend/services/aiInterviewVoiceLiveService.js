const crypto = require('crypto');
const WebSocket = require('ws');
const AIInterviewSession = require('../models/AIInterviewSession');

function hashPublicToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function normalizeEndpoint(endpoint) {
  return String(endpoint || '').trim().replace(/\/+$/, '');
}

function toWebSocketBase(endpoint) {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) return '';
  return normalized.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}

function isAzureVoice(voice) {
  return String(voice || '').includes('-') || String(voice || '').includes(':');
}

function getCurrentQuestion(interview, session) {
  return interview.questionSnapshots?.[session.currentQuestionIndex] || null;
}

function getLatestInterviewerPrompt(session) {
  const currentIndex = session.currentQuestionIndex;
  const messages = [...(session.messages || [])].reverse();
  return messages.find((message) => (
    message.role === 'ai' &&
    message.questionIndex === currentIndex &&
    ['question', 'clarification', 'acknowledgement'].includes(message.messageType)
  ))?.content || '';
}

async function findPublicSession(token) {
  const tokenHash = hashPublicToken(token);
  return AIInterviewSession.findOne({ tokenHash })
    .populate({
      path: 'aiInterview',
      populate: [
        { path: 'job', select: 'title description organization' },
        { path: 'organization', select: 'name' }
      ]
    })
    .populate('job', 'title description')
    .populate('candidate', 'firstName lastName email');
}

class AIInterviewVoiceLiveService {
  constructor() {
    this.wss = null;
  }

  getConfig() {
    const endpoint = normalizeEndpoint(process.env.AZURE_VOICELIVE_ENDPOINT);
    const apiKey = process.env.AZURE_VOICELIVE_API_KEY;
    return {
      endpoint,
      apiKey,
      apiVersion: process.env.AZURE_VOICELIVE_API_VERSION || '2025-10-01',
      callsApiVersion: process.env.AZURE_VOICELIVE_WEBRTC_API_VERSION || '2026-01-01-preview',
      model: process.env.AZURE_VOICELIVE_MODEL || 'gpt-realtime',
      voice: process.env.AZURE_VOICELIVE_VOICE || 'en-US-Ava:DragonHDLatestNeural'
    };
  }

  isConfigured() {
    const config = this.getConfig();
    return Boolean(config.endpoint && config.apiKey && config.model);
  }

  getPublicConfig() {
    const config = this.getConfig();
    return {
      enabled: this.isConfigured(),
      model: config.model,
      voice: config.voice
    };
  }

  buildAzureUrl() {
    const config = this.getConfig();
    const wsBase = toWebSocketBase(config.endpoint);
    const url = new URL(`${wsBase}/voice-live/realtime/calls`);
    url.searchParams.set('api-version', config.callsApiVersion);
    url.searchParams.set('model', config.model);
    return url.toString();
  }

  buildInstructions(session, interview) {
    const currentQuestion = getCurrentQuestion(interview, session);
    const latestPrompt = getLatestInterviewerPrompt(session);
    const total = interview.questionSnapshots?.length || 0;

    return [
      'You are the voice layer for Seemplify AI Interviewer.',
      'The backend application controls the workflow, timers, active question, scoring, and when the interview moves forward.',
      'You must not move to another question, create new assessment questions, score the candidate, reveal rubrics, or reveal expected answers.',
      'Only discuss the current active question.',
      'If the candidate asks for clarification, clarify the current question briefly without answering it for them.',
      'If the candidate answers, acknowledge naturally and remind them to click the Confirm answer & move on button in the page when ready.',
      'Keep spoken replies concise and professional.',
      `Interview title: ${interview.title}`,
      `Candidate: ${session.candidateSnapshot?.name || 'Candidate'}`,
      `Current stage: question ${session.currentQuestionIndex + 1} of ${total}`,
      `Current question: ${currentQuestion?.question || 'No active question'}`,
      `Candidate-facing guidelines: ${interview.guidelines || 'No custom guidelines provided.'}`,
      latestPrompt ? `Latest interviewer text already shown in the page: ${latestPrompt}` : ''
    ].filter(Boolean).join('\n');
  }

  buildSessionUpdate(session, interview) {
    const config = this.getConfig();
    return {
      type: 'session.update',
      session: {
        modalities: ['audio'],
        instructions: this.buildInstructions(session, interview),
        input_audio_transcription: {
          model: 'azure-speech',
          language: 'en'
        },
        turn_detection: {
          type: 'azure_semantic_vad',
          silence_duration_ms: 700,
          create_response: false,
          interrupt_response: false
        },
        input_audio_noise_reduction: { type: 'azure_deep_noise_suppression' },
        input_audio_echo_cancellation: { type: 'server_echo_cancellation' },
        voice: isAzureVoice(config.voice)
          ? { type: 'azure-standard', name: config.voice, temperature: 0.7 }
          : config.voice
      }
    };
  }

  buildSpeakCurrentQuestion(session) {
    const prompt = getLatestInterviewerPrompt(session);
    if (!prompt) return null;

    return this.buildSpeakText(prompt, [
      'Speak the following interviewer message naturally.',
      'Do not add a new question or extra assessment content.',
      'End by reminding the candidate they may answer verbally or ask for clarification.'
    ]);
  }

  buildSpeakText(text, instructionLines = []) {
    const content = String(text || '').trim();
    if (!content) return null;

    return {
      type: 'response.create',
      response: {
        modalities: ['audio'],
        instructions: [
          ...(instructionLines.length ? instructionLines : [
            'Speak the following interviewer message naturally.',
            'Do not add new assessment content.'
          ]),
          '',
          content
        ].join('\n')
      }
    };
  }

  sendJson(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  initialize(server) {
    if (this.wss) return;

    this.wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname !== '/ws/ai-interview-voice') return;

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', async (clientWs, req) => {
      let azureWs = null;
      const pendingMessages = [];

      try {
        const requestUrl = new URL(req.url, 'http://localhost');
        const token = requestUrl.searchParams.get('token');

        if (!this.isConfigured()) {
          this.sendJson(clientWs, { type: 'voice.error', message: 'Voice Live is not configured on the backend.' });
          clientWs.close(1011, 'Voice Live not configured');
          return;
        }

        if (!token) {
          this.sendJson(clientWs, { type: 'voice.error', message: 'Interview token is required.' });
          clientWs.close(1008, 'Missing token');
          return;
        }

        let session = await findPublicSession(token);
        if (!session || !session.aiInterview) {
          this.sendJson(clientWs, { type: 'voice.error', message: 'Interview link not found.' });
          clientWs.close(1008, 'Invalid token');
          return;
        }

        const interview = session.aiInterview;
        const now = new Date();
        if (new Date(interview.schedule.expiresAt) <= now || ['completed', 'expired', 'cancelled'].includes(session.status)) {
          this.sendJson(clientWs, { type: 'voice.error', message: 'This interview is no longer accepting voice responses.' });
          clientWs.close(1008, 'Interview closed');
          return;
        }

        if (session.status !== 'in_progress') {
          this.sendJson(clientWs, { type: 'voice.error', message: 'Start the interview before enabling voice mode.' });
          clientWs.close(1008, 'Interview not started');
          return;
        }

        const config = this.getConfig();
        azureWs = new WebSocket(this.buildAzureUrl(), {
          headers: {
            'api-key': config.apiKey
          }
        });

        azureWs.on('open', () => {
          this.sendJson(azureWs, this.buildSessionUpdate(session, interview));
          this.sendJson(clientWs, {
            type: 'voice.proxy.ready',
            model: config.model,
            voice: config.voice
          });
          while (pendingMessages.length) {
            this.sendJson(azureWs, pendingMessages.shift());
          }
        });

        azureWs.on('message', (data) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
          }
        });

        azureWs.on('close', (code, reason) => {
          this.sendJson(clientWs, {
            type: 'voice.proxy.closed',
            code,
            reason: reason?.toString()
          });
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(code || 1000, reason?.toString() || 'Azure Voice Live closed');
          }
        });

        azureWs.on('error', (error) => {
          console.error('AI interview Voice Live Azure WebSocket error:', error.message);
          this.sendJson(clientWs, { type: 'voice.error', message: error.message });
        });

        clientWs.on('message', async (data) => {
          try {
            const message = JSON.parse(data.toString());

            if (message.type === 'voice.refresh_session') {
              session = await findPublicSession(token);
              if (session?.aiInterview && azureWs?.readyState === WebSocket.OPEN) {
                this.sendJson(azureWs, this.buildSessionUpdate(session, session.aiInterview));
              }
              return;
            }

            if (message.type === 'voice.say_current_question') {
              session = await findPublicSession(token);
              const speakEvent = session ? this.buildSpeakCurrentQuestion(session) : null;
              if (speakEvent && azureWs?.readyState === WebSocket.OPEN) {
                this.sendJson(azureWs, speakEvent);
              }
              return;
            }

            if (message.type === 'voice.speak_text') {
              const speakEvent = this.buildSpeakText(message.text || message.content, [
                'Speak the following interviewer message naturally and concisely.',
                'Do not add a new question, score the candidate, or reveal rubrics.'
              ]);
              if (speakEvent && azureWs?.readyState === WebSocket.OPEN) {
                this.sendJson(azureWs, speakEvent);
              }
              return;
            }

            if (azureWs?.readyState === WebSocket.OPEN) {
              this.sendJson(azureWs, message);
            } else {
              pendingMessages.push(message);
            }
          } catch (error) {
            console.error('AI interview voice client message error:', error.message);
            this.sendJson(clientWs, { type: 'voice.error', message: 'Invalid voice message.' });
          }
        });

        clientWs.on('close', () => {
          if (azureWs && [WebSocket.OPEN, WebSocket.CONNECTING].includes(azureWs.readyState)) {
            azureWs.close(1000, 'Client disconnected');
          }
        });

        clientWs.on('error', (error) => {
          console.error('AI interview voice client WebSocket error:', error.message);
        });
      } catch (error) {
        console.error('AI interview voice connection error:', error.message);
        this.sendJson(clientWs, { type: 'voice.error', message: 'Unable to start voice mode.' });
        if (azureWs && [WebSocket.OPEN, WebSocket.CONNECTING].includes(azureWs.readyState)) {
          azureWs.close();
        }
        clientWs.close(1011, 'Voice setup failed');
      }
    });

    console.log('AI Interview Voice Live proxy initialized on /ws/ai-interview-voice');
  }
}

module.exports = new AIInterviewVoiceLiveService();

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const appraisalAIService = require('../services/appraisalAIService');
const { PerformanceAIRuntimeError } = require('../services/aiGatewayService');

test('required ChatGPT conversation errors are never converted into guided fallback replies', async () => {
  const previousClient = appraisalAIService.client;
  const previousInitialized = appraisalAIService.initialized;
  appraisalAIService.initialized = true;
  appraisalAIService.client = {
    chat: {
      completions: {
        create: async () => {
          throw new PerformanceAIRuntimeError(
            'The ChatGPT gateway is unavailable.',
            'AI_GATEWAY_UNAVAILABLE'
          );
        }
      }
    }
  };

  try {
    await assert.rejects(
      appraisalAIService.startSelfAssessmentConversation(
        { cycleId: { name: 'Annual review' } },
        [],
        { name: 'Employee One' },
        { requireChatGpt: true }
      ),
      (error) => error.code === 'AI_GATEWAY_UNAVAILABLE'
    );
  } finally {
    appraisalAIService.client = previousClient;
    appraisalAIService.initialized = previousInitialized;
  }
});

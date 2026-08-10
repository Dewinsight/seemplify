'use strict';

// Compatibility facade: existing Performance features keep their current
// call shape while all inference is routed through Seemplify's signed gateway.
const aiGatewayService = require('./aiGatewayService');
const { AI_ACTIVITIES } = require('../config/aiActivityCatalog');

module.exports = aiGatewayService;
module.exports.getAzureOpenAIClient = () => aiGatewayService.openAICompatibleClient(AI_ACTIVITIES.MEETING_ANALYSIS);

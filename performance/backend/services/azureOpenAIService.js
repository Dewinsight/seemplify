'use strict';

// Compatibility facade: existing Performance features keep their current
// call shape while all inference is routed through Seemplify's signed gateway.
const aiGatewayService = require('./aiGatewayService');

module.exports = aiGatewayService;
module.exports.getAzureOpenAIClient = () => aiGatewayService.openAICompatibleClient('performance.meeting');

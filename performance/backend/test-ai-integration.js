const AIPerformanceService = require('./services/aiPerformanceService');
require('dotenv').config();

async function testAIIntegration() {
  console.log("Starting AI Integration Test...");

  // 1. Connectivity Check
  console.log("\n--- Testing Connectivity ---");
  const health = await AIPerformanceService.healthCheck();
  console.log("Health Check:", health);
  if (!health.healthy) {
      console.error("Health check failed. Aborting tests.");
      process.exit(1);
  }

  // 2. OKR Generation
  console.log("\n--- Testing OKR Generation ---");
  const okrs = await AIPerformanceService.generateOKRs(
      "Software Engineer",
      "Deliver high-quality code",
      "Become market leader in AI"
  );
  console.log("Generated OKRs:", JSON.stringify(okrs, null, 2));

  // 3. Review Analysis
  console.log("\n--- Testing Review Analysis ---");
  const analysis = await AIPerformanceService.analyzePerformanceReview(
      "I worked hard on the backend service.",
      "The backend service is solid, but communication could be better.",
      "Good team player."
  );
  console.log("Review Analysis:", JSON.stringify(analysis, null, 2));

  // 4. Feedback Analysis
  console.log("\n--- Testing Feedback Analysis ---");
  const feedback = await AIPerformanceService.analyzeFeedback(
      "Great job leading the sprint planning meeting!"
  );
  console.log("Feedback Analysis:", JSON.stringify(feedback, null, 2));

  // 5. Bias Detection
  console.log("\n--- Testing Bias Detection ---");
  const bias = await AIPerformanceService.detectBias(
      "She is very emotional during code reviews."
  );
  console.log("Bias Detection:", JSON.stringify(bias, null, 2));

  console.log("\nAI Integration Test Completed.");
}

testAIIntegration();

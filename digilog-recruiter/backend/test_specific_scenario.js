const timezoneUtils = require('./utils/timezoneUtils');

console.log('🧪 Testing Specific Scenario That Failed\n');

// Test the exact data that caused the error
const failedScenario = {
  startTime: "2025-09-06T05:55",
  endTime: "2025-09-06T05:10", // This is wrong - before start time!
  duration: 15,
  userTimezone: "Europe/London"
};

console.log('Original failed data:', failedScenario);
console.log('Problem: endTime (05:10) is before startTime (05:55)\n');

// Test 1: With the problematic endTime
console.log('--- Test 1: Using problematic endTime ---');
try {
  const result1 = timezoneUtils.processInterviewTimes(
    failedScenario.startTime,
    failedScenario.duration,
    failedScenario.userTimezone,
    failedScenario.endTime
  );
  console.log('✅ Result (should ignore bad endTime):', result1);
} catch (error) {
  console.log('❌ Error:', error.message);
}

// Test 2: Without endTime (duration-based calculation)
console.log('\n--- Test 2: Without endTime (duration-based) ---');
try {
  const result2 = timezoneUtils.processInterviewTimes(
    failedScenario.startTime,
    failedScenario.duration,
    failedScenario.userTimezone,
    null // No endTime provided
  );
  console.log('✅ Result:', result2);
  
  // Verify the calculation
  const startTime = new Date(result2.startTimeISO);
  const endTime = new Date(result2.endTimeISO);
  const actualDuration = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
  
  console.log('Verification:', {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    expectedDuration: failedScenario.duration,
    actualDuration: actualDuration,
    isValid: actualDuration === failedScenario.duration && endTime > startTime
  });
  
} catch (error) {
  console.log('❌ Error:', error.message);
}

console.log('\n🎯 Summary:');
console.log('The fix should:');
console.log('1. ✅ Ignore invalid endTime from frontend');
console.log('2. ✅ Always calculate endTime from startTime + duration');
console.log('3. ✅ Handle timezone conversion properly');
console.log('4. ✅ Validate results before returning');

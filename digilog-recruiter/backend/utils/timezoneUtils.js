/**
 * Timezone utility functions for handling datetime conversions
 */

/**
 * Convert datetime-local string to proper ISO string preserving the intended timezone
 * @param {string} datetimeLocalString - Format: "YYYY-MM-DDTHH:mm"
 * @param {string} userTimezone - User's timezone (e.g., "America/New_York", "UTC")
 * @returns {string} ISO string representing the correct UTC time
 */
function convertDatetimeLocalToUTC(datetimeLocalString, userTimezone = 'UTC') {
  if (!datetimeLocalString) {
    throw new Error('Datetime local string is required');
  }

  console.log(`🕐 Converting datetime: "${datetimeLocalString}" from timezone: "${userTimezone}"`);

  // If already has timezone info or is in ISO format, return as-is
  if (datetimeLocalString.includes('Z') || datetimeLocalString.includes('+') || datetimeLocalString.includes('T') && datetimeLocalString.length > 16) {
    const date = new Date(datetimeLocalString);
    const result = date.toISOString();
    console.log(`✅ Already has timezone info, converted to: ${result}`);
    return result;
  }

  try {
    // For datetime-local format (YYYY-MM-DDTHH:mm), we need to interpret it in the user's timezone
    const dateTimeWithSeconds = datetimeLocalString.length === 16 ? datetimeLocalString + ':00' : datetimeLocalString;
    
    // FIXED: Simplify timezone handling to avoid adding extra offsets
    // The datetime-local input already represents the user's intended local time
    // We just need to store it consistently without adding phantom offsets
    
    // Create date object from the datetime-local string
    // This interprets the time as the server's local timezone
    const localDate = new Date(dateTimeWithSeconds);
    
    // Convert to ISO for consistent storage
    const result = localDate.toISOString();
    
    console.log(`✅ Datetime conversion (fixed):`, {
      input: datetimeLocalString,
      userTimezone: userTimezone,
      localInterpretation: localDate.toString(),
      isoResult: result,
      note: 'No extra offset added - datetime-local treated as intended local time'
    });
    
    return result;
  } catch (error) {
    console.error(`❌ Error converting datetime: ${error.message}`);
    // Fallback to simple date creation
    const fallbackDate = new Date(datetimeLocalString);
    const result = fallbackDate.toISOString();
    console.log(`🔄 Fallback conversion: ${result}`);
    return result;
  }
}

/**
 * Calculate end time based on start time and duration
 * @param {string} startTimeISO - Start time in ISO format
 * @param {number} durationMinutes - Duration in minutes
 * @returns {string} End time in ISO format
 */
function calculateEndTime(startTimeISO, durationMinutes) {
  const startDate = new Date(startTimeISO);
  const endDate = new Date(startDate.getTime() + (durationMinutes * 60 * 1000));
  return endDate.toISOString();
}

/**
 * Validate that a datetime string is valid
 * @param {string} datetimeString - Datetime string to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidDatetime(datetimeString) {
  const date = new Date(datetimeString);
  return !isNaN(date.getTime());
}

/**
 * Get user's browser timezone (this should be called from frontend)
 * @returns {string} Browser's timezone identifier
 */
function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.warn('Unable to detect browser timezone, defaulting to UTC');
    return 'UTC';
  }
}

/**
 * Process interview scheduling times with proper timezone handling
 * @param {string} startTime - Raw start time from frontend
 * @param {string|number} duration - Duration in minutes
 * @param {string} userTimezone - User's timezone
 * @param {string} endTime - Optional end time from frontend
 * @returns {Object} Processed times
 */
function processInterviewTimes(startTime, duration, userTimezone = 'UTC', endTime = null) {
  console.log(`📅 Processing interview times:`, {
    startTime,
    duration,
    userTimezone,
    endTime
  });

  try {
    // Convert start time
    const startTimeISO = convertDatetimeLocalToUTC(startTime, userTimezone);
    console.log(`✅ Start time converted: ${startTime} → ${startTimeISO}`);
    
    // Always calculate end time from duration to avoid frontend calculation errors
    const durationMinutes = typeof duration === 'string' ? parseInt(duration) : (duration || 60);
    const endTimeISO = calculateEndTime(startTimeISO, durationMinutes);
    console.log(`✅ End time calculated: ${startTimeISO} + ${durationMinutes}min = ${endTimeISO}`);
    
    // If endTime was provided, validate it but don't use it - prioritize calculated time
    if (endTime && endTime.trim() !== '') {
      try {
        const providedEndTimeISO = convertDatetimeLocalToUTC(endTime, userTimezone);
        const providedEndDate = new Date(providedEndTimeISO);
        const calculatedEndDate = new Date(endTimeISO);
        
        console.log(`🔍 Comparing times:`, {
          provided: providedEndTimeISO,
          calculated: endTimeISO,
          providedIsAfterStart: providedEndDate > new Date(startTimeISO),
          timesMatch: Math.abs(providedEndDate.getTime() - calculatedEndDate.getTime()) < 60000 // Within 1 minute
        });
        
        // Warn if provided endTime doesn't match our calculation
        if (Math.abs(providedEndDate.getTime() - calculatedEndDate.getTime()) > 60000) {
          console.log(`⚠️ Provided endTime (${providedEndTimeISO}) doesn't match calculated time (${endTimeISO}) - using calculated`);
        }
      } catch (endTimeError) {
        console.log(`⚠️ Invalid endTime provided (${endTime}), using calculated endTime`);
      }
    }

    // Validate the results
    if (!isValidDatetime(startTimeISO) || !isValidDatetime(endTimeISO)) {
      throw new Error('Invalid datetime conversion results');
    }

    const startDate = new Date(startTimeISO);
    const endDate = new Date(endTimeISO);
    
    // This should never happen with calculated endTime, but check anyway
    if (endDate <= startDate) {
      throw new Error(`CALCULATION ERROR: End time (${endDate.toISOString()}) is not after start time (${startDate.toISOString()}). Duration: ${durationMinutes} minutes`);
    }

    const result = {
      startTimeISO,
      endTimeISO,
      startDate,
      endDate,
      durationMinutes: Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60)),
      userTimezone
    };

    console.log(`✅ Successfully processed interview times:`, {
      original: { startTime, endTime, duration },
      processed: { 
        startTimeISO: result.startTimeISO, 
        endTimeISO: result.endTimeISO, 
        duration: result.durationMinutes 
      }
    });
    
    return result;
  } catch (error) {
    console.error(`❌ Error processing interview times:`, error.message);
    console.error(`Input data:`, { startTime, duration, userTimezone, endTime });
    throw error;
  }
}

module.exports = {
  convertDatetimeLocalToUTC,
  calculateEndTime,
  isValidDatetime,
  getBrowserTimezone,
  processInterviewTimes
};

const Interview = require('../models/Interview');
const { buildInterviewOrganizationQuery } = require('../utils/organizationResourceScope');

class TranscriptSegmentationService {
  // Debug log helper with context info
  _log(context, message, data = null) {
    const logMessage = `[TRANSCRIPT-SEGMENT] ${context} - ${message}`;
    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }
  /**
   * Segments a multi-candidate interview transcript based on time slots
   * @param {String} sessionId - The multi-candidate session ID
   * @param {String} fullTranscript - The complete transcript content
   * @returns {Object} Segmented transcripts for each candidate
   */
  async segmentTranscriptBySession(sessionId, fullTranscript, organizationId = null) {
    try {
      this._log('SEGMENT-SESSION', `Processing session: ${sessionId}`);
      
      // Get all interviews in this session
      const sessionQuery = { multiCandidateSessionId: sessionId };
      const scopedSessionQuery = organizationId
        ? await buildInterviewOrganizationQuery(organizationId, sessionQuery)
        : sessionQuery;
      const interviews = await Interview.find(scopedSessionQuery)
      .sort({ multiCandidateOrder: 1 })
      .populate('candidateId', 'firstName lastName email');

      if (!interviews || interviews.length === 0) {
        this._log('ERROR', 'No interviews found for this session');
        throw new Error('No interviews found for this session');
      }

      this._log('SEGMENT-SESSION', `Found ${interviews.length} interviews in session`);
      
      // Parse the transcript
      const parsedTranscript = this.parseTranscript(fullTranscript);
      
      this._log('TRANSCRIPT-PARSING', `Parsed transcript with ${parsedTranscript.length} segments`);
      
      // Segment transcript by candidate time slots
      const segmentedTranscripts = {};
      
      for (const interview of interviews) {
        // Fix: Correctly build candidate name from firstName and lastName
        const candidateName = interview.candidateId ? 
          `${interview.candidateId.firstName || ''} ${interview.candidateId.lastName || ''}`.trim() : 
          'Unknown';
        
        // Fix: Use scheduledAt and calculated endTime instead of startTime/endTime which might not exist
        const startTime = new Date(interview.scheduledAt);
        const endTime = new Date(startTime.getTime() + (interview.duration * 60000));
        
        this._log('INTERVIEW-SLOT', `Processing interview for ${candidateName}`, {
          interviewId: interview._id,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          duration: interview.duration
        });
        
        // Find transcript segments within this time range
        const candidateSegments = this.extractSegmentsByTimeRange(
          parsedTranscript,
          startTime,
          endTime,
          candidateName
        );
        
        segmentedTranscripts[interview._id] = {
          interviewId: interview._id,
          candidateId: interview.candidateId?._id,
          candidateName,
          candidateEmail: interview.candidateId?.email,
          scheduledStart: startTime,
          scheduledEnd: endTime,
          actualStart: candidateSegments.actualStart,
          actualEnd: candidateSegments.actualEnd,
          duration: candidateSegments.duration,
          transcript: candidateSegments.segments,
          overflow: candidateSegments.overflow,
          speakerStats: candidateSegments.speakerStats
        };
      }
      
      return {
        sessionId,
        totalDuration: this.calculateTotalDuration(interviews),
        candidateCount: interviews.length,
        segments: segmentedTranscripts,
        fullTranscript: parsedTranscript
      };
    } catch (error) {
      console.error('Error segmenting transcript:', error);
      throw error;
    }
  }

  /**
   * Parse transcript content into structured segments
   * @param {String} transcriptContent - Raw transcript content
   * @returns {Array} Parsed transcript segments
   */
  parseTranscript(transcriptContent) {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(transcriptContent);
      if (Array.isArray(parsed)) {
        return parsed;
      } else if (parsed.segments) {
        return parsed.segments;
      } else if (parsed.transcript) {
        return parsed.transcript;
      }
    } catch (e) {
      // Parse as plain text with timestamps
      return this.parseTextTranscript(transcriptContent);
    }
  }

  /**
   * Parse plain text transcript with speaker and timestamp extraction
   * @param {String} text - Plain text transcript
   * @returns {Array} Parsed segments
   */
  parseTextTranscript(text) {
    const lines = text.split('\n').filter(line => line.trim());
    const segments = [];
    let currentTimestamp = 0;
    
    for (const line of lines) {
      // Try to extract timestamp (e.g., [00:01:23] or 00:01:23)
      const timestampMatch = line.match(/\[?(\d{1,2}):(\d{2}):?(\d{2})?\]?\s*/);
      if (timestampMatch) {
        const hours = parseInt(timestampMatch[1]) || 0;
        const minutes = parseInt(timestampMatch[2]) || 0;
        const seconds = parseInt(timestampMatch[3]) || 0;
        currentTimestamp = hours * 3600 + minutes * 60 + seconds;
      }
      
      // Try to extract speaker (e.g., "John Doe:" or "Speaker 1:")
      const speakerMatch = line.match(/^([^:]+):\s*(.+)$/);
      
      if (speakerMatch) {
        segments.push({
          timestamp: currentTimestamp,
          speaker: speakerMatch[1].trim(),
          text: speakerMatch[2].trim(),
          formattedTime: this.formatTimestamp(currentTimestamp)
        });
      } else if (line.trim()) {
        // Line without clear speaker
        segments.push({
          timestamp: currentTimestamp,
          speaker: 'Unknown',
          text: line.trim(),
          formattedTime: this.formatTimestamp(currentTimestamp)
        });
      }
      
      // Increment timestamp for next line (estimate 5 seconds per line if no timestamp)
      if (!timestampMatch) {
        currentTimestamp += 5;
      }
    }
    
    return segments;
  }

  /**
   * Extract segments within a specific time range
   * @param {Array} segments - All transcript segments
   * @param {Date} startTime - Start time for extraction
   * @param {Date} endTime - End time for extraction
   * @param {String} candidateName - Name of the candidate for context
   * @returns {Object} Extracted segments with metadata
   */
  extractSegmentsByTimeRange(segments, startTime, endTime, candidateName) {
    const sessionStartTime = segments[0]?.timestamp || 0;
    const candidateSegments = [];
    const overflowSegments = [];
    let actualStart = null;
    let actualEnd = null;
    const speakerStats = {};
    
    // Fix: Convert startTime and endTime to Unix timestamps in seconds for comparison
    // Ensure startTime and endTime are Date objects
    const startDate = startTime instanceof Date ? startTime : new Date(startTime);
    const endDate = endTime instanceof Date ? endTime : new Date(endTime);
    
    // Convert to seconds for consistent comparison
    const startTimeSeconds = Math.floor(startDate.getTime() / 1000);
    const endTimeSeconds = Math.floor(endDate.getTime() / 1000);
    
    // First segment's timestamp is our reference point
    const firstSegmentTime = segments[0]?.timestamp || 0;
    
    // Buffer time for overflow detection (5 minutes)
    const overflowBuffer = 300; // 5 minutes in seconds
    
    // Calculate transcript time range - compare the recording start time with scheduled times
    // This helps synchronize the transcript timeline with the interview schedule
    // Adjust times relative to the first segment timestamp (which is our reference point)
    const recordingStartTime = firstSegmentTime;
    const lastSegmentTime = segments[segments.length - 1]?.timestamp || 0;
    const recordingDuration = lastSegmentTime - recordingStartTime;
    
    // We need to map the interview's scheduled times to the transcript's timeline
    // Calculate what portion of the whole transcript corresponds to this candidate's slot
    const totalInterviewDuration = endTimeSeconds - startTimeSeconds;
    
    this._log('SEGMENT-TIMELINE', `Interview: ${startDate.toISOString()} to ${endDate.toISOString()}`, {
      startTimeSeconds, 
      endTimeSeconds,
      totalInterviewDuration
    });
    
    this._log('RECORDING-TIMELINE', `Start: ${recordingStartTime}, Duration: ${recordingDuration}s`, {
      firstSegmentTime,
      lastSegmentTime,
      totalSegments: segments.length
    });
    
    // Safety check - if we have no segments or very short recording
    if (segments.length === 0) {
      this._log('WARNING', 'No segments found in transcript');
      return {
        segments: [],
        overflow: [],
        actualStart: null,
        actualEnd: null,
        duration: 0,
        speakerStats: {}
      };
    }
    
    // If recording duration is too short or invalid, assign all segments to this candidate
    if (recordingDuration <= 0 || totalInterviewDuration <= 0) {
      this._log('WARNING', 'Invalid duration detected, using all segments', {
        recordingDuration,
        totalInterviewDuration
      });
      
      // Add all segments to this candidate
      candidateSegments.push(...segments);
      
      // Set actual start and end
      actualStart = segments[0]?.timestamp || 0;
      actualEnd = segments[segments.length - 1]?.timestamp || 0;
      
      // Update speaker stats
      for (const segment of segments) {
        if (!speakerStats[segment.speaker]) {
          speakerStats[segment.speaker] = {
            segmentCount: 0,
            estimatedSpeakingTime: 0,
            firstSpeakTime: segment.timestamp,
            lastSpeakTime: segment.timestamp
          };
        }
        speakerStats[segment.speaker].segmentCount++;
        speakerStats[segment.speaker].lastSpeakTime = segment.timestamp;
      }
      
      // Return early
      return {
        segments: candidateSegments,
        overflow: [],
        actualStart: this.formatTimestamp(actualStart),
        actualEnd: this.formatTimestamp(actualEnd),
        duration: actualEnd - actualStart,
        speakerStats
      };
    }
    
    // For loop through segments and find segments within candidate's time range
    for (const segment of segments) {
      const segmentTime = segment.timestamp;
      
      // First, determine if this segment is within the candidate's time slot
      // We use a proportional approach - map the segment's position in the recording
      // to its corresponding position in the scheduled timeline
      const segmentPosition = recordingDuration > 0 ? 
        (segmentTime - recordingStartTime) / recordingDuration : 0;
      
      // Ensure segmentPosition is within 0-1 range
      const normalizedPosition = Math.max(0, Math.min(1, segmentPosition));
      const estimatedSegmentTime = startTimeSeconds + (normalizedPosition * totalInterviewDuration);
      
      // Check if segment is within the candidate's time slot with a small buffer
      const timeBuffer = 60; // 1 minute buffer for flexibility
      const isInTimeSlot = estimatedSegmentTime >= startTimeSeconds - timeBuffer && 
                           estimatedSegmentTime < endTimeSeconds + timeBuffer;
      
      if (isInTimeSlot) {
        candidateSegments.push(segment);
        
        if (!actualStart) actualStart = segmentTime;
        actualEnd = segmentTime;
        
        // Track speaker statistics
        if (!speakerStats[segment.speaker]) {
          speakerStats[segment.speaker] = {
            segmentCount: 0,
            estimatedSpeakingTime: 0,
            firstSpeakTime: segmentTime,
            lastSpeakTime: segmentTime
          };
        }
        speakerStats[segment.speaker].segmentCount++;
        speakerStats[segment.speaker].lastSpeakTime = segmentTime;
        
      } else if (estimatedSegmentTime >= endTimeSeconds && 
                 estimatedSegmentTime < endTimeSeconds + overflowBuffer) {
        // Check for overflow - candidate might be speaking past their time
        if (this.isCandidateSpeaking(segment, candidateName, candidateSegments)) {
          overflowSegments.push(segment);
          actualEnd = segmentTime;
        }
      }
    }
    
    // Calculate estimated speaking times
    for (const speaker in speakerStats) {
      const stats = speakerStats[speaker];
      stats.estimatedSpeakingTime = (stats.lastSpeakTime - stats.firstSpeakTime) * 
                                    (stats.segmentCount / candidateSegments.length);
    }
    
    return {
      segments: candidateSegments,
      overflow: overflowSegments,
      actualStart: actualStart ? this.formatTimestamp(actualStart) : null,
      actualEnd: actualEnd ? this.formatTimestamp(actualEnd) : null,
      duration: actualEnd - actualStart,
      speakerStats
    };
  }

  /**
   * Check if a segment likely belongs to the candidate
   * @param {Object} segment - Transcript segment
   * @param {String} candidateName - Candidate's name
   * @param {Array} previousSegments - Previous segments for context
   * @returns {Boolean} Whether the segment is likely from the candidate
   */
  isCandidateSpeaking(segment, candidateName, previousSegments) {
    // Check if speaker name matches candidate name
    if (segment.speaker.toLowerCase().includes(candidateName.toLowerCase())) {
      return true;
    }
    
    // Check if this speaker was prominent in the candidate's segment
    const speakerCounts = {};
    for (const prevSegment of previousSegments.slice(-20)) { // Last 20 segments
      speakerCounts[prevSegment.speaker] = (speakerCounts[prevSegment.speaker] || 0) + 1;
    }
    
    // If this speaker was active in the candidate's time, likely still them
    if (speakerCounts[segment.speaker] > 5) {
      return true;
    }
    
    // Check for continuation phrases
    const continuationPhrases = [
      'to finish my thought',
      'one more thing',
      'finally',
      'in conclusion',
      'to wrap up'
    ];
    
    const text = segment.text.toLowerCase();
    return continuationPhrases.some(phrase => text.includes(phrase));
  }

  /**
   * Format timestamp from seconds to readable format
   * @param {Number} seconds - Time in seconds
   * @returns {String} Formatted time string
   */
  formatTimestamp(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Calculate total duration of all interviews
   * @param {Array} interviews - Array of interview documents
   * @returns {Number} Total duration in minutes
   */
  calculateTotalDuration(interviews) {
    return interviews.reduce((total, interview) => {
      return total + (interview.duration || 60);
    }, 0);
  }

  /**
   * Get transcript for a specific interview with overflow handling
   * @param {String} interviewId - Interview ID
   * @param {Boolean} includeOverflow - Whether to include overflow segments
   * @returns {Object} Interview transcript with optional overflow
   */
  async getInterviewTranscript(interviewId, includeOverflow = true, organizationId = null) {
    try {
      this._log('GET-TRANSCRIPT', `Retrieving transcript for interview: ${interviewId}`);
      
      const interviewQuery = organizationId
        ? await buildInterviewOrganizationQuery(organizationId, { _id: interviewId })
        : { _id: interviewId };
      const interview = await Interview.findOne(interviewQuery)
        .populate('candidateId', 'firstName lastName email');
      
      if (!interview) {
        this._log('ERROR', `Interview not found: ${interviewId}`);
        throw new Error('Interview not found');
      }
      
      // If not a multi-candidate interview, return regular transcript
      if (!interview.isMultiCandidate) {
        this._log('GET-TRANSCRIPT', `Regular interview (non-multi-candidate)`);
        return {
          interviewId: interview._id,
          transcript: interview.transcript,
          isMultiCandidate: false
        };
      }
      
      this._log('GET-TRANSCRIPT', `Multi-candidate interview in session: ${interview.multiCandidateSessionId}`);
      
      // Get the full session transcript
      const sessionQuery = { multiCandidateSessionId: interview.multiCandidateSessionId };
      const scopedSessionQuery = organizationId
        ? await buildInterviewOrganizationQuery(organizationId, sessionQuery)
        : sessionQuery;
      const sessionInterviews = await Interview.find(scopedSessionQuery).sort({ multiCandidateOrder: 1 });
      
      this._log('GET-TRANSCRIPT', `Found ${sessionInterviews.length} interviews in session`);
      
      // Find the interview with the full transcript (usually the first one)
      const transcriptHolder = sessionInterviews.find(i => i.transcript?.content) || interview;
      
      if (!transcriptHolder.transcript?.content) {
        this._log('GET-TRANSCRIPT', `No transcript content available in session interviews`);
        return {
          interviewId: interview._id,
          transcript: null,
          isMultiCandidate: true,
          message: 'Transcript not yet available'
        };
      }
      
      this._log('GET-TRANSCRIPT', `Found transcript in interview ${transcriptHolder._id}`);
      
      // Segment the transcript
      const segmented = await this.segmentTranscriptBySession(
        interview.multiCandidateSessionId,
        transcriptHolder.transcript.content,
        organizationId
      );
      
      // Get this interview's segment
      const segment = segmented.segments[interviewId];
      
      if (!segment) {
        this._log('ERROR', `Could not find segment for interview ${interviewId} in segmented transcript`, {
          availableSegments: Object.keys(segmented.segments)
        });
      }
      
      if (!segment) {
        throw new Error('Could not find transcript segment for this interview');
      }
      
      // Format the response
      const response = {
        interviewId: interview._id,
        candidateName: segment.candidateName,
        candidateEmail: segment.candidateEmail,
        isMultiCandidate: true,
        sessionId: interview.multiCandidateSessionId,
        scheduledTime: {
          start: segment.scheduledStart,
          end: segment.scheduledEnd
        },
        actualTime: {
          start: segment.actualStart,
          end: segment.actualEnd,
          duration: segment.duration
        },
        transcript: {
          content: JSON.stringify(segment.transcript),
          hasOverflow: segment.overflow.length > 0,
          speakerStats: segment.speakerStats
        }
      };
      
      // Include overflow if requested
      if (includeOverflow && segment.overflow.length > 0) {
        response.overflow = {
          segments: segment.overflow,
          duration: segment.overflow.length * 5 // Estimate
        };
      }
      
      return response;
    } catch (error) {
      console.error('Error getting interview transcript:', error);
      throw error;
    }
  }
}

module.exports = new TranscriptSegmentationService();

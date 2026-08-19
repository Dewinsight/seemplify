const STOP_WORDS = new Set([
  'about', 'answer', 'ask', 'candidate', 'could', 'current', 'for', 'from', 'have',
  'interview', 'question', 'that', 'the', 'this', 'what', 'when', 'which', 'with',
  'would', 'your', 'you'
]);
const CLARIFICATION_INTENT_WORDS = new Set([
  'again', 'can', 'clarification', 'clarify', 'define', 'explain', 'mean', 'meaning',
  'means', 'please', 'repeat', 'rephrase', 'understand'
]);

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return new Set((normalize(value).toLowerCase().match(/[a-z0-9+#.-]{3,}/g) || [])
    .filter((token) => !STOP_WORDS.has(token)));
}

function overlapCount(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  return [...leftTokens].filter((token) => rightTokens.has(token)).length;
}

function subjectTokens(value) {
  return new Set([...tokens(value)].filter((token) => !CLARIFICATION_INTENT_WORDS.has(token)));
}

function sentenceCount(value) {
  return normalize(value).split(/(?<=[.!?])\s+/).filter(Boolean).length;
}

function isInterviewProcessRequest(value) {
  const text = normalize(value).toLowerCase();
  return /(?:how many|questions? (?:left|remain)|time (?:left|remain)|how (?:long|much time)|go back|previous question|repeat (?:that|it|the question)|remind me|confirm button|microphone|\bmic\b|interview (?:work|finish|end)|what did (?:i|we|you) (?:say|mention|discuss)|what (?:we|you) (?:said|discussed)|(?:said|discussed|mentioned) (?:earlier|before))/i.test(text);
}

function assessIntroduction(content, question) {
  const text = normalize(content);
  const issues = [];
  if (text.length < 30 || text.length > 900) issues.push('Keep the introduction concise but complete.');
  if (sentenceCount(text) > 5) issues.push('Use no more than five sentences.');
  if (!text.includes('?')) issues.push('Ask the selected question explicitly.');
  const questionTokenCount = tokens(question).size;
  const requiredQuestionOverlap = Math.min(2, questionTokenCount);
  if (requiredQuestionOverlap > 0 && overlapCount(text, question) < requiredQuestionOverlap) {
    issues.push('Preserve the concrete meaning and terms of the selected question.');
  }
  if ((text.match(/\?/g) || []).length > 2) issues.push('Do not add extra assessment questions.');
  if (!/(clarif|answer|ready)/i.test(text)) issues.push('Tell the candidate they may clarify or answer when ready.');
  if (/(expected answer|scoring criteria|rubric|ideal answer)/i.test(text)) issues.push('Do not reveal hidden scoring guidance.');
  return { passed: issues.length === 0, issues };
}

function assessSpeechRendition(content, question) {
  const text = normalize(content);
  const source = normalize(question);
  const issues = [];
  if (!text || text.length > Math.max(1200, source.length * 2)) {
    issues.push('Keep the spoken rendition complete and close in length to the original question.');
  }
  const sourceTokens = tokens(source);
  const requiredOverlap = Math.min(sourceTokens.size, Math.max(1, Math.ceil(sourceTokens.size * 0.65)));
  if (requiredOverlap > 0 && overlapCount(text, source) < requiredOverlap) {
    issues.push('Preserve the original question, its concrete terms, constraints, and assessment intent.');
  }
  if (source.includes('?') && !text.includes('?')) issues.push('Keep the original question explicit.');
  const sourceQuestionMarks = (source.match(/\?/g) || []).length;
  if ((text.match(/\?/g) || []).length > Math.max(1, sourceQuestionMarks)) {
    issues.push('Do not add any new question or assessment prompt.');
  }
  if (/(expected answer|scoring criteria|rubric|ideal answer)/i.test(text)) {
    issues.push('Do not reveal hidden scoring guidance.');
  }
  return { passed: issues.length === 0, issues };
}

function assessClarification(content, { question, candidateMessage }) {
  const text = normalize(content);
  const issues = [];
  const processRequest = isInterviewProcessRequest(candidateMessage);
  if (text.length < 20 || text.length > 900) issues.push('Keep the clarification brief but useful.');
  if (sentenceCount(text) > 5) issues.push('Use no more than five sentences.');
  if (!processRequest && overlapCount(text, question) < 1) issues.push('Keep the clarification anchored to the selected question.');
  const requestedSubjects = subjectTokens(candidateMessage);
  if (!processRequest && requestedSubjects.size && ![...tokens(text)].some((token) => requestedSubjects.has(token))) {
    issues.push('Address the exact term or request raised by the candidate.');
  }
  if ((text.match(/\?/g) || []).length > 1) issues.push('Do not introduce additional assessment questions.');
  if (/(expected answer|scoring criteria|rubric|ideal answer|you should say|best answer is)/i.test(text)) issues.push('Do not reveal or supply an answer.');
  return { passed: issues.length === 0, issues };
}

function assessAcknowledgement(content) {
  const text = normalize(content);
  const issues = [];
  if (text.length < 15 || text.length > 420) issues.push('Keep the acknowledgement concise.');
  if (sentenceCount(text) > 3) issues.push('Use no more than three sentences.');
  if (!/(confirm|button|move (?:on|to)|next question)/i.test(text)) issues.push('Tell the candidate how to move on.');
  if (text.includes('?')) issues.push('Do not ask a follow-up question.');
  if (/(excellent|great answer|strong answer|weak answer|correct|incorrect|score|scoring|rating)/i.test(text)) issues.push('Do not evaluate or score the answer.');
  return { passed: issues.length === 0, issues };
}

function repairInstruction(kind, assessment) {
  return `The previous ${kind} did not meet the live-interview quality contract. Rewrite it and fix every issue:\n${assessment.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')}\nReturn only the revised candidate-facing message.`;
}

module.exports = {
  assessAcknowledgement,
  assessClarification,
  assessIntroduction,
  assessSpeechRendition,
  isInterviewProcessRequest,
  repairInstruction
};

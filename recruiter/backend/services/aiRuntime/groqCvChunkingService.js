const DEFAULT_MAX_CHARS = 5_500;
const DEFAULT_OVERLAP_CHARS = 350;
const EMPTY_STRINGS = new Set(['', 'n/a', 'na', 'none', 'null', 'unknown', 'not provided']);

function splitCvText(text, { maxChars = DEFAULT_MAX_CHARS, overlapChars = DEFAULT_OVERLAP_CHARS } = {}) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];
  const chunks = [];
  let offset = 0;
  while (offset < normalized.length) {
    let end = Math.min(normalized.length, offset + maxChars);
    if (end < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', end);
      const lineBreak = normalized.lastIndexOf('\n', end);
      const boundary = Math.max(paragraphBreak, lineBreak);
      if (boundary > offset + Math.floor(maxChars * 0.6)) end = boundary;
    }
    const chunk = normalized.slice(offset, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    offset = Math.max(offset + 1, end - overlapChars);
  }
  return chunks;
}

function stableKey(value) {
  if (typeof value === 'string') return value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (value && typeof value === 'object') {
    const preferred = value.company || value.institution || value.title || value.name || value.organization;
    const secondary = value.position || value.degree || value.date || value.startDate || value.issueDate;
    if (preferred) return `${stableKey(preferred)}|${stableKey(secondary || '')}`;
  }
  return JSON.stringify(value);
}

function mergeArrays(left = [], right = []) {
  const merged = [];
  const indexByKey = new Map();
  for (const item of [...left, ...right]) {
    const key = stableKey(item);
    if (!key) continue;
    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      if (
        merged[index] && item
        && typeof merged[index] === 'object' && !Array.isArray(merged[index])
        && typeof item === 'object' && !Array.isArray(item)
      ) {
        merged[index] = mergeValues(merged[index], item);
      }
      continue;
    }
    indexByKey.set(key, merged.length);
    merged.push(item);
  }
  return merged;
}

function meaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return !EMPTY_STRINGS.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function mergeValues(left, right, key = '') {
  if (!meaningful(left)) return right;
  if (!meaningful(right)) return left;
  if (Array.isArray(left) && Array.isArray(right)) return mergeArrays(left, right);
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const merged = { ...left };
    for (const [childKey, value] of Object.entries(right)) {
      merged[childKey] = mergeValues(merged[childKey], value, childKey);
    }
    return merged;
  }
  if (typeof left === 'number' && typeof right === 'number') return Math.max(left, right);
  if (typeof left === 'string' && typeof right === 'string') {
    if (['summary', 'experience', 'education', 'experienceSummary', 'careerProgression', 'leadershipExperience', 'technicalDepth'].includes(key)) {
      return right.length > left.length ? right : left;
    }
    return left;
  }
  return left;
}

function mergeCvExtractions(extractions = []) {
  return extractions.reduce((merged, extraction) => mergeValues(merged, extraction) || {}, {});
}

function estimateRequestTokens({ messages = [], schema, maxOutputTokens = 0 }) {
  const messageChars = messages.reduce((sum, message) => sum + String(message?.content || '').length, 0);
  const schemaChars = schema ? JSON.stringify(schema).length : 0;
  return Math.ceil((messageChars + schemaChars) / 4) + Math.max(0, Number(maxOutputTokens || 0)) + 200;
}

class GroqTokenBudget {
  constructor({
    tokensPerMinute = 7_200,
    windowMs = 60_000,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}) {
    this.tokensPerMinute = Math.max(1, Number(tokensPerMinute || 7_200));
    this.windowMs = Math.max(1, Number(windowMs || 60_000));
    this.now = now;
    this.sleep = sleep;
    this.windowStartedAt = this.now();
    this.reserved = 0;
    this.tail = Promise.resolve();
  }

  reserve(tokens) {
    const requested = Math.min(this.tokensPerMinute, Math.max(1, Math.ceil(Number(tokens || 1))));
    const reservation = this.tail.then(async () => {
      let elapsed = this.now() - this.windowStartedAt;
      if (elapsed >= this.windowMs) {
        this.windowStartedAt = this.now();
        this.reserved = 0;
        elapsed = 0;
      }
      if (this.reserved + requested > this.tokensPerMinute) {
        await this.sleep(Math.max(1, this.windowMs - elapsed));
        this.windowStartedAt = this.now();
        this.reserved = 0;
      }
      this.reserved += requested;
      return { requested, reserved: this.reserved, windowStartedAt: this.windowStartedAt };
    });
    this.tail = reservation.catch(() => {});
    return reservation;
  }
}

module.exports = {
  DEFAULT_MAX_CHARS,
  GroqTokenBudget,
  estimateRequestTokens,
  mergeCvExtractions,
  splitCvText
};

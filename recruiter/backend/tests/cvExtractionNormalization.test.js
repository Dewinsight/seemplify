const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCvExtractedFields,
  normalizeStringArray,
  normalizeStringValue
} = require('../utils/normalizeCvExtraction');

test('normalizes harmless model variations before Candidate validation', () => {
  const normalized = normalizeCvExtractedFields({
    firstName: ['Ada'],
    lastName: 'Lovelace',
    experience: 8,
    skills: 'JavaScript',
    strengths: [],
    potentialFlags: null,
    educationHistory: [{
      institution: 'University of London',
      degree: 'BSc Computer Science',
      graduationYear: 2020,
      honors: []
    }],
    languages: [{ language: 'English', proficiency: 'Fluent', certifications: [] }],
    projects: [{ title: 'Compiler', technologies: 'COBOL', highlights: [null, 'Production use'] }],
    portfolioLinks: { github: null, other: 'https://example.test' }
  });

  assert.equal(normalized.firstName, 'Ada');
  assert.equal(normalized.experience, '8');
  assert.deepEqual(normalized.skills, ['JavaScript']);
  assert.equal(Object.hasOwn(normalized.educationHistory[0], 'honors'), false);
  assert.equal(normalized.educationHistory[0].graduationYear, '2020');
  assert.equal(Object.hasOwn(normalized.languages[0], 'certifications'), false);
  assert.deepEqual(normalized.projects[0].technologies, ['COBOL']);
  assert.deepEqual(normalized.projects[0].highlights, ['Production use']);
  assert.deepEqual(normalized.portfolioLinks.other, ['https://example.test']);
});

test('drops empty placeholders while retaining meaningful scalar arrays', () => {
  assert.equal(normalizeStringValue([]), undefined);
  assert.equal(normalizeStringValue(['N/A', '']), undefined);
  assert.equal(normalizeStringValue(['Alpha', 'Beta']), 'Alpha, Beta');
  assert.deepEqual(normalizeStringArray(['N/A', 'Redis', 4]), ['Redis', '4']);
});

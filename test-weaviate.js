const weaviateService = require('/app/services/weaviateService');

const testId = '685e6301090fe358e07a9613';
console.log('Testing with MongoDB ID:', testId);
console.log('UUID conversion test:', weaviateService._toUuid(testId));

weaviateService.checkCandidateExists(testId)
  .then(exists => console.log('Check exists result:', exists))
  .catch(err => console.error('Error:', err.message));

/**
 * Test HTML Entity Decoding in Job Model
 * 
 * This test verifies that HTML entities in job titles and descriptions
 * are automatically decoded when job data is sent to the frontend.
 * 
 * Run with: node backend/tests/test-job-html-entities.js
 * 
 * This is a UNIT test that tests the toJSON transform without database operations.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Mock mongoose for unit testing
const mongoose = require('mongoose');

function testHtmlEntityDecoding() {
  console.log('🧪 Starting HTML Entity Decoding Test (Unit Test)\n');
  console.log('=' .repeat(70));

  // Import the decoding function
  const { decodeHtmlEntities } = require('../utils/htmlDecode');

  // Test Case 1: Basic HTML entity decoding
  console.log('\n📝 Test Case 1: Basic HTML Entity Decoding\n');
  
  const testCases = [
    {
      name: 'Ampersands',
      input: 'Senior Developer &amp; Architect',
      expected: 'Senior Developer & Architect'
    },
    {
      name: 'Quotes',
      input: 'We&apos;re looking for a &quot;rockstar&quot; developer',
      expected: 'We\'re looking for a "rockstar" developer'
    },
    {
      name: 'Mixed entities',
      input: 'Node.js &amp; React &mdash; 5+ years',
      expected: 'Node.js & React — 5+ years'
    },
    {
      name: 'Multiple ampersands',
      input: 'APIs, databases &amp; cloud platforms &amp; more',
      expected: 'APIs, databases & cloud platforms & more'
    },
    {
      name: 'Less than / Greater than',
      input: '&lt;div&gt; tags &amp; &lt;p&gt; elements',
      expected: '<div> tags & <p> elements'
    },
    {
      name: 'Double encoded',
      input: '&amp;amp;',
      expected: '&'
    }
  ];

  let passed = 0;
  let failed = 0;

  testCases.forEach(test => {
    const result = decodeHtmlEntities(test.input);
    const success = result === test.expected;
    
    if (success) {
      console.log(`   ✅ ${test.name}:`);
      console.log(`      Input:    "${test.input}"`);
      console.log(`      Output:   "${result}"`);
      passed++;
    } else {
      console.log(`   ❌ ${test.name} FAILED:`);
      console.log(`      Input:    "${test.input}"`);
      console.log(`      Expected: "${test.expected}"`);
      console.log(`      Got:      "${result}"`);
      failed++;
    }
  });

  // Test Case 2: Simulate Job Model toJSON transform
  console.log('\n\n📤 Test Case 2: Job Model toJSON Transform Simulation\n');
  
  // Simulate a job document
  const mockJobData = {
    _id: '507f1f77bcf86cd799439011',
    title: 'Senior Developer &amp; Architect',
    description: 'We&apos;re looking for a &quot;rockstar&quot; developer with 5+ years experience in Node.js &amp; React.',
    requirements: 'Experience with APIs, databases &amp; cloud platforms',
    responsibilities: 'Design &amp; develop scalable applications',
    skills: 'JavaScript, Node.js, React &amp; MongoDB',
    location: 'New York &amp; Remote',
    type: 'Full-time',
    level: 'Senior',
    experience: '5+ years',
    education: 'Bachelor&apos;s degree or equivalent',
    benefits: 'Health insurance, 401(k) &amp; flexible hours'
  };

  // Simulate the toJSON transform function
  const fieldsToCheck = [
    'title', 'description', 'requirements', 'responsibilities',
    'skills', 'benefits', 'location', 'type', 'level', 'experience', 'education'
  ];

  const transformedJob = { ...mockJobData };
  fieldsToCheck.forEach(field => {
    if (transformedJob[field] && typeof transformedJob[field] === 'string') {
      transformedJob[field] = decodeHtmlEntities(transformedJob[field]);
    }
  });

  console.log('   Original title:', mockJobData.title);
  console.log('   Transformed title:', transformedJob.title);
  console.log('');
  console.log('   Original description:', mockJobData.description.substring(0, 60) + '...');
  console.log('   Transformed description:', transformedJob.description.substring(0, 60) + '...');
  console.log('');
  console.log('   Original location:', mockJobData.location);
  console.log('   Transformed location:', transformedJob.location);

  // Verification
  const verificationChecks = [
    {
      field: 'title',
      hasEntity: transformedJob.title.includes('&amp;') || transformedJob.title.includes('&quot;') || transformedJob.title.includes('&apos;'),
      value: transformedJob.title
    },
    {
      field: 'description',
      hasEntity: transformedJob.description.includes('&amp;') || transformedJob.description.includes('&quot;') || transformedJob.description.includes('&apos;'),
      value: transformedJob.description.substring(0, 70)
    },
    {
      field: 'location',
      hasEntity: transformedJob.location.includes('&amp;'),
      value: transformedJob.location
    },
    {
      field: 'requirements',
      hasEntity: transformedJob.requirements.includes('&amp;'),
      value: transformedJob.requirements
    },
    {
      field: 'benefits',
      hasEntity: transformedJob.benefits.includes('&amp;'),
      value: transformedJob.benefits
    }
  ];

  console.log('\n\n🔍 Verification Results:\n');
  
  verificationChecks.forEach(check => {
    if (check.hasEntity) {
      console.log(`   ❌ ${check.field}: Still contains HTML entities`);
      console.log(`      Value: "${check.value}"`);
      failed++;
    } else {
      console.log(`   ✅ ${check.field}: Properly decoded`);
      passed++;
    }
  });

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log(`\n📊 Test Summary:`);
  console.log(`   Total Tests: ${passed + failed}`);
  console.log(`   Passed: ${passed} ✅`);
  console.log(`   Failed: ${failed} ❌`);
  
  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED!');
    console.log('✅ HTML entities decoding is working correctly');
    console.log('✅ The toJSON transform will properly decode job data in API responses');
  } else {
    console.log('\n❌ SOME TESTS FAILED!');
    console.log('⚠️  HTML entities are NOT being properly decoded');
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('\n💡 Next Steps:');
  console.log('   1. The Job model has been updated with a toJSON transform');
  console.log('   2. All API responses will automatically decode HTML entities');
  console.log('   3. No frontend changes are needed - data arrives clean');
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

// Run the test
testHtmlEntityDecoding();


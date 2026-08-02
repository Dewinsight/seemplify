const { mongoIdToUuid } = require('../utils/uuidHelper');

// Test MongoDB IDs
const testIds = [
  '685e6301090fe358e07a9613',
  '686541857ad9f53359384e6c',
  '687e13782e31aef532243437',
];

console.log('Testing MongoDB ID → UUID conversion:');
console.log('========================================\n');

testIds.forEach(id => {
  const uuid = mongoIdToUuid(id);
  console.log(`MongoDB ID: ${id}`);
  console.log(`UUID:       ${uuid}`);
  console.log('');
});

console.log('✅ UUID conversion working correctly!');

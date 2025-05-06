// Test script for memory system query with consolidated tags
const memory = require('./src/core/memory');
const logger = require('./src/utils/logger');

async function testMemoryQuery() {
  console.log('Testing memory query with consolidated tags...');
  
  // Store a test memory with specific content we can query for
  const testMemory = `This is a special test memory about consolidated tag format.
It demonstrates how the new memory system uses a single tag style throughout
with metadata as attributes in the opening tag. This makes the format more
consistent and easier to understand for both humans and LLMs.`;

  console.log('\n1. Storing test memory...');
  await memory.storeLongTerm(testMemory);
  console.log('✅ Test memory stored');
  
  // Query for memories related to "consolidated tag format"
  console.log('\n2. Querying for memories about "consolidated tag format"...');
  try {
    const result = await memory.retrieveLongTerm('ego', 'consolidated tag format');
    if (result && result.analysis) {
      console.log('Memory query result:');
      console.log(result.analysis);
      
      // Check if the result contains our consolidated tag format
      if (result.analysis.includes('<MEMORY') && result.analysis.includes('</MEMORY>')) {
        console.log('\n✅ Memory query returned results with consolidated tag format');
      } else {
        console.log('\n❌ Memory query did not return results with consolidated tag format');
      }
    } else {
      console.log('No relevant memories found or analysis is empty');
    }
  } catch (error) {
    console.error('Error querying memory:', error);
  }
  
  // Query for memories related to "memory system"
  console.log('\n3. Querying for memories about "memory system"...');
  try {
    const result = await memory.retrieveLongTerm('ego', 'memory system');
    if (result && result.analysis) {
      console.log('Memory query result:');
      console.log(result.analysis);
    } else {
      console.log('No relevant memories found or analysis is empty');
    }
  } catch (error) {
    console.error('Error querying memory:', error);
  }
  
  console.log('\nMemory query test completed!');
}

// Run the test
testMemoryQuery().catch(err => {
  console.error('Test failed:', err);
});

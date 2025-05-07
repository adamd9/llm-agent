const memory = require('./src/core/memory');
const logger = require('./src/utils/logger');
const sharedEventEmitter = require('./src/utils/eventEmitter');

// Set up event listener for subsystem messages
sharedEventEmitter.on('subsystemMessage', (event) => {
  if (event.content.type === 'memory_retrieval_query') {
    console.log('\n=== MEMORY RETRIEVAL QUERY ===');
    console.log(`Context: ${event.content.context}`);
    console.log(`Question: ${event.content.question}`);
    console.log('===============================\n');
  }
  
  if (event.content.type === 'memory_retrieval_messages') {
    console.log('\n=== MEMORY RETRIEVAL MESSAGES ===');
    console.log('System prompt:');
    console.log(event.content.messages[0].content);
    console.log('\nUser prompt:');
    console.log(event.content.messages[1].content);
    console.log('==================================\n');
  }
  
  if (event.content.type === 'memory_retrieval_result') {
    console.log('\n=== MEMORY RETRIEVAL RESULT ===');
    console.log(`Result: ${event.content.result}`);
    console.log('================================\n');
  }
});

async function testMemoryRetrieval() {
  try {
    console.log('Starting memory retrieval test...');
    
    // Test direct memory retrieval with name query
    const nameQuery = "what is my name";
    console.log(`Testing memory retrieval with query: "${nameQuery}"`);
    
    const result = await memory.retrieveLongTerm('ego', nameQuery);
    console.log(`\nDirect result: ${result}`);
    
    console.log('\nMemory retrieval test completed');
  } catch (error) {
    console.error('Error in memory retrieval test:', error);
  }
}

// Run the test
testMemoryRetrieval();

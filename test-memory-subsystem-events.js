// Test script for memory subsystem events
const memory = require('./src/core/memory');
const logger = require('./src/utils/logger');
const sharedEventEmitter = require('./src/utils/eventEmitter');

// Register listener for subsystem messages
sharedEventEmitter.on('subsystemMessage', (message) => {
  if (message.module === 'ego' && message.content.type === 'memory_retrieval_result') {
    console.log('\n📡 Ego Memory Retrieval Result:', JSON.stringify(message.content, null, 2));
  }
});

async function testMemorySubsystemEvents() {
  console.log('Testing memory subsystem events...');
  
  try {
    // Test 1: Store short-term memory
    console.log('\n1. Testing short-term memory storage...');
    await memory.storeShortTerm('Test context', 'This is a test memory for subsystem events', 'test');
    console.log('✅ Short-term memory stored');
    
    // Test 2: Retrieve short-term memory
    console.log('\n2. Testing short-term memory retrieval...');
    const shortTermMemory = await memory.retrieveShortTerm();
    console.log(`✅ Short-term memory retrieved (${shortTermMemory.length} bytes)`);
    
    // Test 3: Store long-term memory
    console.log('\n3. Testing long-term memory storage...');
    await memory.storeLongTerm('This is a test long-term memory for subsystem events');
    console.log('✅ Long-term memory stored');
    
    // Test 4: Retrieve long-term memory
    console.log('\n4. Testing long-term memory retrieval...');
    const longTermMemory = await memory.retrieveLongTerm('ego', 'What are the subsystem events?');
    console.log('✅ Long-term memory retrieved');
    
    console.log('\nMemory subsystem events test completed successfully!');
  } catch (error) {
    console.error('\nError during memory subsystem events test:', error);
  }
}

// Run the test
testMemorySubsystemEvents().catch(err => {
  console.error('Test failed:', err);
});

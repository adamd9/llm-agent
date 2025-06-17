const { getClient } = require('./src/utils/llmClient');
const logger = require('./src/utils/logger');

// Create a large message that will exceed the token limit
function createLargeMessage(size) {
  // Each character is roughly 1/4 of a token, so we need size*4 characters
  // to generate approximately 'size' tokens
  return 'A'.repeat(size * 4);
}

async function testTokenLimit() {
  try {
    console.log('Testing token limit feature...');
    
    // Get the OpenAI client
    const client = getClient('openai');
    
    // Create a message that should exceed the default 10000 token limit
    // We'll create a message with approximately 12000 tokens
    const largeContent = createLargeMessage(12000);
    
    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: largeContent }
    ];
    
    console.log(`Message created with approximately 12000 tokens`);
    console.log('Attempting to send request...');
    
    // This should throw an error due to token limit
    const response = await client.chat(messages);
    
    // If we get here, the token limit check failed
    console.error('ERROR: Token limit check failed! Request was processed despite exceeding the limit.');
    
  } catch (error) {
    if (error.message.includes('Token limit exceeded')) {
      console.log('SUCCESS: Token limit check worked correctly!');
      console.log(`Error message: ${error.message}`);
    } else {
      console.error('ERROR: Unexpected error occurred:');
      console.error(error);
    }
  }
}

// Run the test
testTokenLimit().catch(err => {
  console.error('Unhandled error in test:', err);
});

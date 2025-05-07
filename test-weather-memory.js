const memory = require('./src/core/memory');
const logger = require('./src/utils/logger');
const llmqueryopenai = require('./src/tools/llmqueryopenai');

async function testWeatherMemory() {
  try {
    logger.debug('Test', 'Starting weather memory retrieval test');
    
    // Test direct memory retrieval
    const weatherQuery = "What's the weather like today?";
    logger.debug('Test', 'Testing memory retrieval for weather query', { query: weatherQuery });
    
    const longTermMemory = await memory.retrieveLongTerm('ego', weatherQuery);
    logger.debug('Test', 'Retrieved long-term memory for weather query', { 
      memory: longTermMemory 
    });
    
    // Test the LLM query tool with the weather query
    logger.debug('Test', 'Testing LLM query tool with weather query');
    const result = await llmqueryopenai.execute('query', [
      { name: 'query', value: weatherQuery }
    ]);
    
    logger.debug('Test', 'LLM query result', { 
      result: result.data.result 
    });
    
    logger.debug('Test', 'Weather memory retrieval test completed successfully');
  } catch (error) {
    logger.error('Test', 'Error in weather memory retrieval test', {
      error: error.message,
      stack: error.stack
    });
  }
}

// Run the test
testWeatherMemory();

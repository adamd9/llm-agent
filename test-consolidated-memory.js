// Test script for memory system with consolidated tags
const memory = require('./src/core/memory');
const logger = require('./src/utils/logger');
const fs = require('fs');
const path = require('path');

async function testConsolidatedMemoryFormat() {
  console.log('Testing memory system with consolidated tags...');
  
  // Test storing short-term memory with multi-line content
  const shortTermData = `This is a test of multi-line memory content.
It includes multiple lines of text.
And even some code:
\`\`\`javascript
function test() {
  return "Hello World";
}
\`\`\``;

  console.log('\n1. Storing short-term memory with multi-line content...');
  await memory.storeShortTerm('test-context', shortTermData, 'test-module');
  console.log('✅ Short-term memory stored');
  
  // Test storing long-term memory with multi-line content
  const longTermData = `This is a test of long-term memory with consolidated tags.
It uses a cleaner format with metadata as attributes in the opening tag.
Let's see how it handles formatting:
- Bullet point 1
- Bullet point 2
  - Nested bullet point`;

  console.log('\n2. Storing long-term memory with multi-line content...');
  const result = await memory.storeLongTerm(longTermData);
  console.log('✅ Long-term memory stored with category:', result.category);
  
  // Test retrieving short-term memory
  console.log('\n3. Retrieving short-term memory...');
  const shortTermMemory = memory.retrieveShortTerm();
  console.log('Short-term memory content:');
  console.log(shortTermMemory);
  
  // Test parsing memory content
  console.log('\n4. Testing memory content parsing...');
  const parsedMemories = memory.parseMemoryContent(shortTermMemory);
  console.log('Parsed memories:');
  console.log(JSON.stringify(parsedMemories, null, 2));
  
  // Display the raw long-term memory file content
  console.log('\n5. Examining raw long-term memory file...');
  const longTermPath = path.join(__dirname, 'data', 'memory', 'long', 'long_term.txt');
  if (fs.existsSync(longTermPath)) {
    const longTermContent = fs.readFileSync(longTermPath, 'utf-8');
    
    // Show the last few lines of the file (the newly added memory)
    const lines = longTermContent.split('\n');
    const lastLines = lines.slice(-10).join('\n');
    
    console.log('Last 10 lines of long-term memory file:');
    console.log(lastLines);
    
    // Parse the long-term memory content
    console.log('\n6. Parsing long-term memory content...');
    const parsedLongTermMemories = memory.parseMemoryContent(lastLines);
    console.log('Parsed long-term memories:');
    console.log(JSON.stringify(parsedLongTermMemories, null, 2));
  } else {
    console.log('Long-term memory file does not exist yet');
  }
  
  // Store another long-term memory for retrieval testing
  console.log('\n7. Storing another long-term memory for retrieval testing...');
  const anotherMemory = `This is another test memory specifically about consolidated tag format.
The new memory system uses <MEMORY> and </MEMORY> tags with metadata as attributes
in the opening tag, making it easier for both humans and LLMs to understand
the structure of memory content. This consolidated format replaces the previous
mixed format that used both brackets and XML-like tags.`;
  
  await memory.storeLongTerm(anotherMemory);
  console.log('✅ Additional long-term memory stored');
  
  // Wait a moment for the file to be written
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test retrieving long-term memory
  console.log('\n8. Retrieving long-term memory...');
  try {
    const longTermResult = await memory.retrieveLongTerm('ego', 'consolidated tag format');
    if (longTermResult && longTermResult.analysis) {
      console.log('Long-term memory retrieval result:');
      console.log(longTermResult.analysis);
    } else {
      console.log('No relevant memories found or analysis is empty');
    }
  } catch (error) {
    console.error('Error retrieving long-term memory:', error);
  }
  
  console.log('\nMemory system test completed!');
}

// Run the test
testConsolidatedMemoryFormat().catch(err => {
  console.error('Test failed:', err);
});

// Test script for reflection with a single memory entry using the new consolidated tag format
const Ego = require('./src/core/ego');
const logger = require('./src/utils/logger');
const fs = require('fs');
const path = require('path');

async function testReflectionWithSingleEntry() {
  console.log('Testing reflection with a single memory entry using the new consolidated tag format...');
  
  // Create an instance of Ego
  const ego = new Ego();
  await ego.initialize();
  
  // Trigger the reflection process
  console.log('\n1. Triggering reflection process...');
  await ego.reflection();
  console.log('✅ Reflection process completed');
  
  // Check the long-term memory file to verify the format
  console.log('\n2. Checking long-term memory file for reflection entries...');
  const longTermPath = path.join(__dirname, 'data', 'memory', 'long', 'long_term.txt');
  
  if (fs.existsSync(longTermPath)) {
    const longTermContent = fs.readFileSync(longTermPath, 'utf-8');
    
    // Get the last 15 lines of the file (should include our new reflection entry)
    const lines = longTermContent.split('\n');
    const lastLines = lines.slice(-15).join('\n');
    
    console.log('Last 15 lines of long-term memory file:');
    console.log(lastLines);
    
    // Check if the new format is being used with a single memory entry
    if (lastLines.includes('<MEMORY module="ego"') && 
        lastLines.includes('[ReflectionMarker] Starting reflection process') && 
        lastLines.includes('[ReflectionMarker] Completed reflection process') &&
        lastLines.includes('[Insight]') &&
        lastLines.includes('[Lesson]') &&
        lastLines.includes('[FollowUp]') &&
        // Make sure we're only looking at the latest entry
        lastLines.match(/<MEMORY module="ego"[^>]*>[^<]*\[ReflectionMarker\] Starting reflection process/s)) {
      console.log('\n✅ Reflection is using a single memory entry with the new consolidated tag format');
    } else {
      console.log('\n❌ Reflection is NOT using a single memory entry with the new consolidated tag format');
      
      // Count the number of <MEMORY> tags in the last lines
      const memoryTagCount = (lastLines.match(/<MEMORY module="ego"/g) || []).length;
      console.log(`Found ${memoryTagCount} <MEMORY> tags in the last 15 lines`);
    }
  } else {
    console.log('Long-term memory file does not exist');
  }
  
  console.log('\nReflection test completed!');
}

// Run the test
testReflectionWithSingleEntry().catch(err => {
  console.error('Test failed:', err);
});

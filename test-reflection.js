// Test script for reflection with the new memory format
const Ego = require('./src/core/ego');
const logger = require('./src/utils/logger');
const fs = require('fs');
const path = require('path');

async function testReflectionWithNewMemoryFormat() {
  console.log('Testing reflection with new memory format...');
  
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
    
    // Get the last 20 lines of the file (should include our new reflection entries)
    const lines = longTermContent.split('\n');
    const lastLines = lines.slice(-20).join('\n');
    
    console.log('Last 20 lines of long-term memory file:');
    console.log(lastLines);
    
    // Check if the new format is being used
    if (lastLines.includes('<MEMORY module="ego"') && 
        lastLines.includes('[ReflectionMarker]') && 
        lastLines.includes('</MEMORY>')) {
      console.log('\n✅ Reflection is using the new consolidated tag format');
    } else {
      console.log('\n❌ Reflection is NOT using the new consolidated tag format');
    }
  } else {
    console.log('Long-term memory file does not exist');
  }
  
  console.log('\nReflection test completed!');
}

// Run the test
testReflectionWithNewMemoryFormat().catch(err => {
  console.error('Test failed:', err);
});

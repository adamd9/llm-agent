const memory = require('./src/core/memory');
const logger = require('./src/utils/logger');
const fs = require('fs');
const path = require('path');

// Test script to demonstrate LLM-based memory consolidation
async function testMemoryConsolidation() {
    try {
        logger.debug('Test', 'Starting LLM-based memory consolidation test');
        
        // First, let's add some test memories that demonstrate different scenarios
        logger.debug('Test', 'Adding test memories with duplicates and low-value content');
        
        // Memory 1 - Original memory with reflection markers (low-value metadata)
        await memory.storeLongTerm('[ReflectionMarker] Starting reflection process at 2025-05-07T13:28:20.184Z\n\n[Insight] The system should maintain a balance between factual accuracy and conversational tone.\n\n[ReflectionMarker] Completed reflection process at 2025-05-07T13:28:20.184Z');
        
        // Memory 2 - Similar to Memory 1 but with slight differences
        await memory.storeLongTerm('[ReflectionMarker] Starting reflection process at 2025-05-07T13:32:02.279Z\n\n[Insight] The system should maintain a balance between factual accuracy and conversational tone.\n\n[Lesson] Continue to provide accurate information while adapting tone based on user preferences.');
        
        // Memory 3 - Unique memory with valuable content
        await memory.storeLongTerm('User prefers concise responses with technical details presented in bullet points. Avoid lengthy explanations unless specifically requested.');
        
        // Memory 4 - Another unique memory
        await memory.storeLongTerm('The system should use the OpenAI responses API (client.responses.create) instead of the chat completions API. This is an intentional design choice.');
        
        // Memory 5 - Near-duplicate of Memory 4 with additional details
        await memory.storeLongTerm('The LLMQueryOpenAITool must use the OpenAI responses API (client.responses.create) instead of the chat completions API. The responses API is used with web_search_preview tool and takes input parameter instead of messages.');
        
        // Now run the LLM-based consolidation
        logger.debug('Test', 'Running LLM-based memory consolidation');
        const result = await memory.consolidateLongTerm();
        
        // Log the results
        logger.debug('Test', 'Consolidation complete', {
            originalCount: result.originalCount,
            consolidatedCount: result.consolidatedCount,
            removedCount: result.removedCount,
            backupPath: result.backupPath
        });
        
        // Display the consolidated memories
        const longTermPath = path.join(__dirname, 'data/memory/long');
        const longTermFile = path.join(longTermPath, 'long_term.txt');
        const consolidatedContent = fs.readFileSync(longTermFile, 'utf-8');
        
        console.log('Memory Consolidation Test Results:');
        console.log('----------------------------------');
        console.log(`Original memories: ${result.originalCount}`);
        console.log(`Consolidated memories: ${result.consolidatedCount}`);
        console.log(`Duplicates/low-value content removed: ${result.removedCount}`);
        console.log(`Backup created at: ${result.backupPath}`);
        console.log('----------------------------------');
        console.log('Consolidated Memory Content:');
        console.log('----------------------------------');
        console.log(consolidatedContent);
        console.log('----------------------------------');
        
        return result;
    } catch (error) {
        logger.error('Test', 'Error in memory consolidation test', {
            error: error.message,
            stack: error.stack
        });
        console.error('Test failed:', error);
        throw error;
    }
}

// Run the test
testMemoryConsolidation()
    .then(result => {
        console.log('Test completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('Test failed:', error);
        process.exit(1);
    });

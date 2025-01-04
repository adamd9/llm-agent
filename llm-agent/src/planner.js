const { OpenAI } = require('openai');
require('dotenv').config();
const toolManager = require('./tools');

async function planner(enrichedMessage) {
    try {
        console.log('Planning for message:', enrichedMessage);
        
        // Load available tools
        const tools = await toolManager.loadTools();
        console.log('Available tools for planning:', tools.map(t => t.name));

        // For now, a simple plan based on the message
        const plan = {
            steps: []
        };

        // Example: If message contains 'list' and 'files', use the fileSystem tool
        if (enrichedMessage.original_message.toLowerCase().includes('list') || 
            enrichedMessage.original_message.toLowerCase().includes('files') ||
            enrichedMessage.original_message.toLowerCase().includes('show')) {
            plan.steps.push({
                description: 'List files in the specified directory',
                tool: 'fileSystem',
                action: 'list',
                parameters: {
                    path: enrichedMessage.original_message.includes('dataroot') ? 
                          '/usr/src/app/data' : '/usr/src/app'
                }
            });
        }

        console.log('Generated plan:', plan);

        return {
            status: 'success',
            plan: JSON.stringify(plan)
        };
    } catch (error) {
        console.error('Error in planner:', error);
        return {
            status: 'error',
            error: error.message
        };
    }
}

module.exports = { planner };

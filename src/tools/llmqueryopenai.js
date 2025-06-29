const OpenAI = require('openai');
const logger = require('../utils/logger');
const { loadSettings } = require('../utils/settings');
const fs = require('fs').promises;
const path = require('path');
const memory = require('../core/memory');

/** @implements {import('../types/tool').Tool} */
class LLMQueryOpenAITool {
    constructor() {
        this.name = 'llmqueryopenai';
        this.description = 'Query OpenAI with web search capability for up-to-date information';
        this.defaultModel = 'gpt-4.1';
        this.client = null;
    }

    /** @returns {import('../types/tool').ToolCapabilities} */
    getCapabilities() {
        return {
            actions: [{
                name: 'query',
                description: 'Search the web for current information',
                parameters: [{
                    name: 'query',
                    description: 'The search query',
                    type: 'string',
                    required: true
                }]
            }]
        };
    }

    initialize() {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }
        this.client = new OpenAI();
        const settings = loadSettings();
        if (settings.queryModel) {
            this.defaultModel = settings.queryModel;
        } else if (settings.llmModel) {
            this.defaultModel = settings.llmModel;
        }
        logger.debug('llmqueryopenai.initialize', 'OpenAI client initialized');
    }

    /**
     * Execute the tool
     * @param {string} action - The action to execute
     * @param {Array<{name: string, value: string}>} parameters - The parameters for the action
     * @param {Object} context - The context for the action
     * @returns {Promise<Object>} - The result of the action
     */
    async execute(action, parameters, context = {}) {
        if (!this.client) {
            this.initialize();
        }

        logger.debug('llmqueryopenai.execute', 'Starting execution', { action, parameters });

        if (action !== 'query') {
            throw new Error(`Invalid action: ${action}`);
        }

        const queryParam = parameters.find(p => p.name === 'query');
        if (!queryParam) {
            throw new Error('Missing required parameter: query');
        }

        try {
            // Retrieve memory
            const shortTermMemory = await memory.retrieveShortTerm();

            // Construct input with memory context
            const input = `
            ${queryParam.value}
            Use the following memory:
            Short term memory (from this conversation):
            ${JSON.stringify(shortTermMemory)}
            `;

            // Call OpenAI responses API
            const settings = loadSettings();
            const model = settings.queryModel || settings.llmModel || this.defaultModel;
            const response = await this.client.responses.create({
                model,
                tools: [{ type: "web_search_preview" }],
                input: input
            });

            logger.debug('llmqueryopenai.execute - Response received', { 
                output_text_length: response.output_text ? response.output_text.length : 0 
            });

            // Return the raw response from the LLM
            const result = {
                status: 'success',
                data: {
                    query: queryParam.value,
                    result: response.output_text || 'No output text available'
                }
            };

            logger.debug('llmqueryopenai.execute - Returning final result', { result });
            
            return result;
        } catch (error) {
            logger.error('llmqueryopenai.execute - Error', error);
            return {
                status: 'error',
                error: `OpenAI API error: ${error.status} ${error.error?.message || error.message}`
            };
        }
    }
}

// Export singleton instance
module.exports = new LLMQueryOpenAITool();

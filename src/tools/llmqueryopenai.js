const OpenAI = require('openai');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

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
            // Create responses directory if it doesn't exist
            const responsesDir = path.join(__dirname, '../../data/temp/openai_responses');
            await fs.mkdir(responsesDir, { recursive: true });

            // Call OpenAI responses API
            const response = await this.client.responses.create({
                model: this.defaultModel,
                tools: [{ type: "web_search_preview" }],
                input: queryParam.value
            });

            // Save raw response for analysis
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const responseFile = path.join(responsesDir, `response_${timestamp}.json`);
            await fs.writeFile(responseFile, JSON.stringify(response, null, 2));

            logger.debug('llmqueryopenai.execute - Raw response saved to', { responseFile });

            // For now, return a simplified result format
            const result = {
                status: 'success',
                data: {
                    query: queryParam.value,
                    result: response.output_text || 'No output text available',
                    raw_response_file: responseFile
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

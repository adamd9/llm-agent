const { OpenAI } = require('openai');
const logger = require('../utils/logger');
require('dotenv').config();

/** @implements {import('../types/tool').Tool} */
class LLMQueryOpenAITool {
    constructor() {
        this.name = 'llmqueryopenai';
        this.description = 'Tool for searching the internet for up-to-date information. Only use this tool when you need current information from the web. For general conversations and queries, use the llmquery tool instead.';
        
        // Get API key from environment
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('OPENAI_API_KEY environment variable is not set or is empty');
        }
        
        // Initialize OpenAI client
        this.client = new OpenAI({
            apiKey: apiKey.trim()
        });
        
        // Set default model
        this.defaultModel = 'gpt-4.1';
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

    /**
     * Execute the tool
     * @param {string} action - The action to execute
     * @param {Array<{name: string, value: string}>} parameters - The parameters for the action
     * @param {Object} context - The context for the action
     * @returns {Promise<Object>} - The result of the action
     */
    async execute(action, parameters, context = {}) {
        logger.debug('llmqueryopenai.execute - Starting', { action, parameters });

        if (action !== 'query') {
            throw new Error(`Invalid action: ${action}`);
        }

        const queryParam = parameters.find(p => p.name === 'query');
        if (!queryParam) {
            throw new Error('Missing required parameter: query');
        }

        try {
            logger.debug('llmqueryopenai.execute - Making initial chat completion request', { query: queryParam.value });
            // First, create a chat completion to perform the web search
            const response = await this.client.chat.completions.create({
                model: this.defaultModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant with access to web search. Please search the web for current information.'
                    },
                    {
                        role: 'user',
                        content: queryParam.value
                    }
                ],
                tools: [{
                    type: "function",
                    function: {
                        name: "web_search",
                        description: "Search the web for current information",
                        parameters: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "The search query"
                                }
                            },
                            required: ["query"]
                        }
                    }
                }],
                tool_choice: {
                    type: "function",
                    function: {
                        name: "web_search"
                    }
                }
            });

            logger.debug('llmqueryopenai.execute - Initial response received', {
                id: response.id,
                model: response.model,
                tool_calls: response.choices[0].message.tool_calls?.map(tc => ({
                    name: tc.function.name,
                    arguments: tc.function.arguments
                }))
            });

            // Get the tool call from the response
            const toolCall = response.choices[0].message.tool_calls?.[0];
            if (!toolCall) {
                throw new Error('No tool call found in response');
            }

            // Parse the tool call arguments
            const args = JSON.parse(toolCall.function.arguments);
            logger.debug('llmqueryopenai.execute - Tool call arguments', { args });

            // Make another API call to get the search results
            logger.debug('llmqueryopenai.execute - Making search request', { query: args.query });
            const searchResponse = await this.client.chat.completions.create({
                model: this.defaultModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant with access to web search. Please provide the search results.'
                    },
                    {
                        role: 'user',
                        content: args.query
                    }
                ]
            });

            logger.debug('llmqueryopenai.execute - Search response received', {
                id: searchResponse.id,
                model: searchResponse.model,
                content: searchResponse.choices[0].message.content
            });

            // Return the final response
            const result = {
                status: 'success',
                data: {
                    query: args.query,
                    result: searchResponse.choices[0].message.content
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

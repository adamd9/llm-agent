const logger = require('../utils/logger.js');
const memory = require('../memory');
const { getOpenAIClient } = require("../utils/openaiClient.js");

class LLMQueryTool {
    constructor() {
        this.name = 'llmquery';
        this.description = 'Tool for sending any type of query to the LLM and receiving a response.';
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'query',
                    description: 'Send any type of query to the LLM and receive a response. Uses the Assists personality.',
                    parameters: [
                        {
                            name: 'query',
                            description: 'Query content to send to the LLM.',
                            type: 'string',
                            required: true
                        }
                    ]
                }
            ]
        };
    }

    async query(parameters) {
        const queryParam = parameters.find(param => param.name === 'query');
        if (!queryParam) {
            throw new Error('Missing required parameter: query');
        }

        logger.debug('LLMQueryTool', 'Sending query:', queryParam.value);
        let query;
        if (typeof queryParam.value === 'string') {
            query = queryParam.value;
        } else if (typeof queryParam.value === 'object') {
            query = JSON.stringify(queryParam.value);
        } else {
            throw new Error('Input must be a string or an object');
        }

        const shortTermMemory = await memory.retrieveShortTerm();
        const longTermRelevantMemory = await memory.retrieveLongTerm('ego', 'retrieve anything relevant to carrying out a users request');

        let userPrompt = `
        ${query}
        Use the following memory:
        Short term memory (from this conversation):
        ${JSON.stringify(shortTermMemory)}
        Long term relevant memory:
        ${JSON.stringify(longTermRelevantMemory)}
        `;

        const systemPrompt = await this.buildSystemPrompt();

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        logger.debug('llmquery', 'messages being sent to OpenAI', { messages }, false);
        const openai = getOpenAIClient();
        const response = await openai.chat(messages, {
            model: 'gpt-4o-mini',
            temperature: 0.7,
            max_tokens: 1000
        });

        logger.debug('llmquery', 'OpenAI response', { response }, false);
        const receivedMessage = response.content;
        return { status: 'success', message: `Response: ${receivedMessage}` };
    }

    async execute(action, parameters) {
        logger.debug('llmquery executing:', JSON.stringify({ action, parameters }));
        try {
            let parsedParams = parameters;
            if (typeof parameters === 'string') {
                try {
                    parsedParams = JSON.parse(parameters);
                } catch (parseError) {
                    logger.debug('llmquery', 'Parameter parsing error:', {
                        error: parseError.message,
                        parameters
                    });
                    return {
                        status: 'success',
                        parameters
                    };
                }
            }

            switch (action) {
                case 'query':
                    return await this.query(parsedParams);
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            console.error('LLMQueryTool error:', {
                error: error.message,
                action,
                parameters
            });
            return {
                status: 'error',
                error: error.message
            };
        }
    }

    async buildSystemPrompt() {
        return `You are an internal query processor for an AI agent system. Your responses will be further processed and interpreted by the agent, not shown directly to users. Focus on providing clear, structured, and precise information that can be effectively utilized by the agent in its decision-making and task execution processes. Avoid conversational elements, pleasantries, or explanations meant for human users.`;
    }
}

module.exports = new LLMQueryTool();

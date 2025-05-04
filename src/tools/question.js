const logger = require('../utils/logger.js');
const { validateToolResponse } = require('../validation/toolValidator');

/** @implements {import('../types/tool').Tool} */
class QuestionTool {
    constructor() {
        this.name = 'question';
        this.description = 'Tool for asking clarifying questions to the user when additional information is needed.';
    }

    /** @returns {import('../types/tool').ToolCapabilities} */
    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'ask',
                    description: 'Ask a clarifying question to the user and wait for their response.',
                    parameters: [
                        {
                            name: 'question',
                            description: 'The question to ask the user.',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'context',
                            description: 'Optional context explaining why this question is being asked.',
                            type: 'string',
                            required: false
                        }
                    ]
                }
            ]
        };
    }

    /**
     * Ask a question to the user
     * @param {any[]} parameters - Tool parameters
     * @returns {Promise<import('../types/tool').ToolResponse>}
     */
    async ask(parameters) {
        const questionParam = parameters.find(param => param.name === 'question');
        if (!questionParam) {
            return { status: 'error', error: 'Missing required parameter: question' };
        }

        let question;
        if (typeof questionParam.value === 'string') {
            question = questionParam.value;
        } else if (typeof questionParam.value === 'object') {
            question = JSON.stringify(questionParam.value);
        } else {
            return { status: 'error', error: 'Question must be a string or an object' };
        }

        // Get optional context parameter
        const contextParam = parameters.find(param => param.name === 'context');
        let context = '';
        if (contextParam && contextParam.value) {
            if (typeof contextParam.value === 'string') {
                context = contextParam.value;
            } else if (typeof contextParam.value === 'object') {
                context = JSON.stringify(contextParam.value);
            }
        }

        logger.debug('QuestionTool', 'Asking question:', { question, context });

        // The actual response would come from the user via the coordinator
        // For now, we just return a message indicating that a question has been asked
        const toolResponse = { 
            status: 'success', 
            message: 'Question has been asked to the user.',
            data: {
                question,
                context: context || undefined,
                needsUserResponse: true
            }
        };
        
        const validation = validateToolResponse(toolResponse);
        if (!validation.isValid) {
            logger.error('QuestionTool', 'Invalid tool response:', validation.errors);
            return { status: 'error', error: 'Internal tool response validation failed' };
        }
        
        return toolResponse;
    }

    /**
     * @param {string} action - Action to execute
     * @param {any[]} parameters - Action parameters
     * @returns {Promise<import('../types/tool').ToolResponse>}
     */
    async execute(action, parameters) {
        logger.debug('QuestionTool executing:', JSON.stringify({ action, parameters }));
        try {
            let parsedParams = parameters;
            if (typeof parameters === 'string') {
                try {
                    parsedParams = JSON.parse(parameters);
                } catch (parseError) {
                    logger.debug('QuestionTool', 'Parameter parsing error:', {
                        error: parseError.message,
                        parameters
                    });
                    return {
                        status: 'error',
                        error: 'Invalid parameters format'
                    };
                }
            }

            switch (action) {
                case 'ask':
                    return await this.ask(parsedParams);
                default:
                    return {
                        status: 'error',
                        error: `Unknown action: ${action}`
                    };
            }
        } catch (error) {
            logger.error('QuestionTool error:', {
                error: error.message,
                stack: error.stack,
                action,
                parameters
            });
            return {
                status: 'error',
                error: error.message
            };
        }
    }
}

module.exports = new QuestionTool();

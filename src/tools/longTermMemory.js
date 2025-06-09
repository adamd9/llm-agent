const logger = require('../utils/logger');
const memory = require('../core/memory');

// New MemoryTool class for interacting with long-term memory
class LongTermMemoryTool {
    constructor() {
        this.name = 'longTermMemoryTool';
        this.description = 'Tool for long-term memory operations, to remember things for later retrieval';
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'storeLongTerm',
                    description: 'Remember something for later retrieval',
                    parameters: [
                        {
                            name: 'data',
                            description: 'Data to store in long-term memory. Multi-line content will be automatically enclosed in <MEMORY> and </MEMORY> tags with appropriate attributes.',
                            type: 'string',
                            required: true
                        }
                    ]
                },
                {
                    name: 'retrieveLongTerm',
                    description: 'Retrieve data from long-term memory',
                    parameters: [
                        {
                            name: 'question',
                            description: 'Question or query to ask for retrieval',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'context',
                            description: 'Context to use for retrieval (e.g. ego, execution, planning, evaluation)',
                            type: 'string',
                            required: false
                        }
                    ]
                }
            ]
        };
    }

    async initialize() {
    }

    async storeLongTerm(parameters) {
        const dataParam = parameters.find(param => param.name === 'data');
        if (!dataParam) {
            throw new Error('Missing required parameter: data');
        }
        try {
            const result = await memory.storeLongTerm(dataParam.value);
            const actionResponse = {
                status: 'success',
                result
            };
            logger.debug('LongTermMemory stored data:', actionResponse);
            return actionResponse;
        } catch (error) {
            return {
                status: 'error',
                error: 'Failed to store data'
            };
        }
    }

    async retrieveLongTerm(parameters) {
        const questionParam = parameters.find(param => param.name === 'question');
        const contextParam = parameters.find(param => param.name === 'context');
        if (!questionParam) {
            throw new Error('Missing required parameter: question');
        }
        try {
            const shortTermMemory = await memory.retrieveShortTerm();
            const result = await memory.retrieveLongTerm(contextParam ? contextParam.value : null, questionParam.value, shortTermMemory);
            return {
                status: 'success',
                result: result
            };
        } catch (error) {
            return {
                status: 'error',
                error: 'Failed to retrieve data'
            };
        }
    }

    async execute(action, parameters) {
        logger.debug('LongTermMemory executing:', JSON.stringify({ action, parameters }));
        try {
            // Parse parameters if they're passed as a string
            let parsedParams = parameters;
            if (typeof parameters === 'string') {
                try {
                    parsedParams = JSON.parse(parameters);
                } catch (parseError) {
                    logger.error('Parameter parsing error:', {
                        error: parseError.message,
                        parameters
                    });
                    return {
                        status: 'error',
                        error: 'Invalid parameters format',
                        details: parseError.message
                    };
                }
            }

            switch (action) {
                case 'storeLongTerm':
                    return await this.storeLongTerm(parsedParams);
                case 'retrieveLongTerm':
                    return await this.retrieveLongTerm(parsedParams);
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            console.error('LongTermMemory tool error:', {
                error: error.message,
                stack: error.stack,
                action,
                parameters
            });
            return {
                status: 'error',
                error: error.message,
                stack: error.stack,
                action,
                parameters
            };
        }
    }
}

module.exports = new LongTermMemoryTool();

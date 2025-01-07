const logger = require('../utils/logger');
const memory = require('../memory');

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
                            description: 'Data to store in long-term memory',
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
                            description: 'Context to use for retrieval',
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

    async storeLongTerm(data) {
        try {
            const result = await memory.storeLongTerm(data); // Call the storeLongTerm method from Memory
            return {
                status: 'success',
                result
            };
        } catch (error) {
            return {
                status: 'error',
                error: 'Failed to store data'
            };
        }
    }

    async retrieveLongTerm(context, question) {
        try {
            const result = await memory.retrieveLongTerm(context, question); // Call the retrieveLongTerm method from Memory
            return {
                status: 'success',
                result
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
                return await this.storeLongTerm(parsedParams.data);
            case 'retrieveLongTerm':
                return await this.retrieveLongTerm(parsedParams.context, parsedParams.question);
            case 'initialize':
                return await this.initialize();
            default:
                throw new Error(`Action '${action}' is not recognized.`);
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

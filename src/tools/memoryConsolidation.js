const logger = require('../utils/logger');
const memory = require('../core/memory');
const { validateToolResponse } = require('../validation/toolValidator');

/** @implements {import('../types/tool').Tool} */
class MemoryConsolidationTool {
    constructor() {
        this.name = 'memoryConsolidation';
        this.description = 'Tool for consolidating long-term memory, removing duplicates and resolving conflicts';
    }

    /** @returns {import('../types/tool').ToolCapabilities} */
    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'consolidate',
                    description: 'Consolidate long-term memory by removing duplicates and resolving conflicts. Newer memories take precedence over older ones with the same content. A backup of the original memory file is created before consolidation.',
                    parameters: []
                }
            ]
        };
    }

    /**
     * Consolidate long-term memory
     * @param {any[]} parameters - Tool parameters (none required for this action)
     * @returns {Promise<import('../types/tool').ToolResponse>}
     */
    async consolidate() {
        try {
            logger.debug('MemoryConsolidationTool', 'Consolidating long-term memory');
            const result = await memory.consolidateLongTerm();
            
            const toolResponse = {
                status: 'success',
                message: result.message,
                data: {
                    originalCount: result.originalCount,
                    consolidatedCount: result.consolidatedCount,
                    removedCount: result.removedCount,
                    backupPath: result.backupPath
                }
            };
            
            const validation = validateToolResponse(toolResponse);
            if (!validation.isValid) {
                logger.error('MemoryConsolidationTool', 'Invalid tool response:', validation.errors);
                return { status: 'error', error: 'Internal tool response validation failed' };
            }
            
            return toolResponse;
        } catch (error) {
            logger.error('MemoryConsolidationTool', 'Error consolidating long-term memory:', {
                error: error.message,
                stack: error.stack
            });
            
            return {
                status: 'error',
                error: error.message,
                stack: error.stack
            };
        }
    }

    /**
     * @param {string} action - Action to execute
     * @param {any} parameters - Action parameters
     * @returns {Promise<import('../types/tool').ToolResponse>}
     */
    async execute(action, parameters) {
        logger.debug('MemoryConsolidationTool executing:', { action, parameters });
        try {
            // Parse parameters if they're passed as a string
            let parsedParams = parameters;
            if (typeof parameters === 'string') {
                try {
                    parsedParams = JSON.parse(parameters);
                } catch (parseError) {
                    logger.debug('MemoryConsolidationTool', 'Parameter parsing error:', {
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
                case 'consolidate':
                    return await this.consolidate(parsedParams);
                default:
                    return {
                        status: 'error',
                        error: `Unknown action: ${action}`
                    };
            }
        } catch (error) {
            logger.error('MemoryConsolidationTool error:', {
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

module.exports = new MemoryConsolidationTool();

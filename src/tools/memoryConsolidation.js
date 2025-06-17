const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const memory = require('../core/memory');
const { validateToolResponse } = require('../validation/toolValidator');
const { getOpenAIClient } = require('../utils/openaiClient.js');
const { loadSettings } = require('../utils/settings');

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
            
            // After consolidating long-term memory, extract insights about self and user
            await this.extractAndUpdateModels();
            
            const toolResponse = {
                status: 'success',
                message: result.message + ' Models for self and user have been updated.',
                data: {
                    originalCount: result.originalCount,
                    consolidatedCount: result.consolidatedCount,
                    removedCount: result.removedCount,
                    backupPath: result.backupPath,
                    modelsUpdated: true
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
     * Extracts insights about the agent (self) and user from memory
     * Updates the respective model files with new information
     * @returns {Promise<void>}
     */
    async extractAndUpdateModels() {
        try {
            logger.debug('MemoryConsolidationTool', 'Extracting insights and updating model files');
            
            // Define paths to model files
            const selfModelPath = path.join(process.cwd(), 'data', 'self', 'models', 'self.md');
            const userModelPath = path.join(process.cwd(), 'data', 'self', 'models', 'user.md');
            
            // Ensure directories exist
            const modelDir = path.dirname(selfModelPath);
            if (!fs.existsSync(modelDir)) {
                fs.mkdirSync(modelDir, { recursive: true });
            }
            
            // Read existing model content if available
            let existingSelfModel = '';
            let existingUserModel = '';
            
            if (fs.existsSync(selfModelPath)) {
                existingSelfModel = fs.readFileSync(selfModelPath, 'utf-8');
            }
            
            if (fs.existsSync(userModelPath)) {
                existingUserModel = fs.readFileSync(userModelPath, 'utf-8');
            }
            
            // Get short-term memory for context
            const shortTermMemory = await memory.retrieveShortTerm();
            
            // Get long-term memory content
            const longTermPath = path.join(process.cwd(), 'data', 'memory', 'long-term.md');
            let longTermMemory = '';
            
            if (fs.existsSync(longTermPath)) {
                longTermMemory = fs.readFileSync(longTermPath, 'utf-8');
            }
            
            // Extract insights using LLM
            const settings = loadSettings();
            const openai = getOpenAIClient();
            
            // First, update the self model
            const selfUpdatePrompt = `
You are analyzing memory data to update a model of an AI agent's understanding of itself.

CURRENT SELF MODEL:
${existingSelfModel}

RECENT INTERACTIONS (SHORT-TERM MEMORY):
${shortTermMemory || 'No recent interactions available.'}

LONG-TERM MEMORY EXCERPTS:
${longTermMemory || 'No long-term memory available.'}

Your task is to extract insights about how the agent works, its capabilities, limitations, and operational guidelines.
Update the self model with any new information learned from the memories.
When there are contradictions between the current model and new information, prefer the newer information.

Provide a complete, updated Markdown document that maintains the existing structure but incorporates new insights.
Do not remove any sections from the original model unless they are explicitly contradicted.
`;

            const selfUpdateResponse = await openai.chat([
                { role: 'system', content: 'You are an AI model analyst that helps maintain accurate models of an AI agent and its user.' },
                { role: 'user', content: selfUpdatePrompt }
            ]);
            
            // Update the self model file
            fs.writeFileSync(selfModelPath, selfUpdateResponse.content);
            logger.debug('MemoryConsolidationTool', 'Self model updated successfully');
            
            // Next, update the user model
            const userUpdatePrompt = `
You are analyzing memory data to update a model of a user interacting with an AI agent.

CURRENT USER MODEL:
${existingUserModel}

RECENT INTERACTIONS (SHORT-TERM MEMORY):
${shortTermMemory || 'No recent interactions available.'}

LONG-TERM MEMORY EXCERPTS:
${longTermMemory || 'No long-term memory available.'}

Your task is to extract insights about the user, including their preferences, patterns, and any relevant information learned through interactions.
Update the user model with any new information learned from the memories.
When there are contradictions between the current model and new information, prefer the newer information.

Provide a complete, updated Markdown document that maintains the existing structure but incorporates new insights.
Do not remove any sections from the original model unless they are explicitly contradicted.
`;

            const userUpdateResponse = await openai.chat([
                { role: 'system', content: 'You are an AI model analyst that helps maintain accurate models of an AI agent and its user.' },
                { role: 'user', content: userUpdatePrompt }
            ]);
            
            // Update the user model file
            fs.writeFileSync(userModelPath, userUpdateResponse.content);
            logger.debug('MemoryConsolidationTool', 'User model updated successfully');
            
        } catch (error) {
            logger.error('MemoryConsolidationTool', 'Error extracting insights and updating model files:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
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

require('dotenv').config();
const { getOpenAIClient } = require('../../utils/openaiClient.js');
const toolManager = require('../../mcp');
const logger = require('../../utils/logger.js');
const memory = require('../memory');
const sharedEventEmitter = require('../../utils/eventEmitter');
const prompts = require('./prompts');

const openai = getOpenAIClient();

/**
 * Creates a plan based on the user's message and available tools
 * @param {Object} enrichedMessage - The enriched message containing the original message and memory
 * @param {Object} client - Optional client for OpenAI
 * @returns {Object} - The planning result
 */
async function planner(enrichedMessage, client = null) {
    try {
        logger.debug('start', 'Planning for message:', enrichedMessage);
        logger.debug('start', 'Starting planning process', {
            message: enrichedMessage.original_message,
            short_term_memory: enrichedMessage.context?.short_term_memory
        });

        // Use cached tools instead of reloading them
        const tools = await toolManager.getAllTools();
        logger.debug('tools', 'Using cached tools:', tools.length);
        logger.debug('tools', 'Available tools loaded', {
            tools: tools.map(t => ({ name: t.name, description: t.description }))
        });

        // Create a plan
        const toolsDescription = formatToolsDescription(tools);

        // Get the short-term memory directly if not provided in the context
        let shortTermMemory = enrichedMessage.context?.short_term_memory;
        if (!shortTermMemory) {
            shortTermMemory = await memory.retrieveShortTerm() || '';
            logger.debug('memory', 'Retrieved short-term memory directly:', {
                length: shortTermMemory.length
            });
        }

        // Ensure shortTermMemory is a string
        if (typeof shortTermMemory === 'object' && shortTermMemory !== null) {
            try {
                // If it's an object, convert it to a formatted string
                shortTermMemory = JSON.stringify(shortTermMemory, null, 2);
                logger.debug('memory', 'Converted short-term memory object to string:', {
                    length: shortTermMemory.length
                });
            } catch (error) {
                logger.error('memory', 'Error converting short-term memory object to string:', {
                    error: {
                        message: error.message,
                        stack: error.stack
                    }
                });
                // Fallback to empty string if conversion fails
                shortTermMemory = '';
            }
        }

        // Get the long-term memory directly if not provided in the context
        let longTermMemory = enrichedMessage.context?.long_term_relevant_memory;
        if (!longTermMemory) {
            // Create a more specific query based on the user's message
            const memoryQuery = `Retrieve any information relevant to: ${enrichedMessage.original_message}`;
            longTermMemory = (await memory.retrieveLongTerm('ego', memoryQuery)) || '';
            logger.debug('memory', 'Retrieved long-term memory directly:', {
                length: longTermMemory.length,
                query: memoryQuery
            });
        }

        // Ensure longTermMemory is a string
        if (typeof longTermMemory === 'object' && longTermMemory !== null) {
            try {
                // If it's an object, convert it to a formatted string
                longTermMemory = JSON.stringify(longTermMemory, null, 2);
                logger.debug('memory', 'Converted long-term memory object to string:', {
                    length: longTermMemory.length
                });
            } catch (error) {
                logger.error('memory', 'Error converting long-term memory object to string:', {
                    error: {
                        message: error.message,
                        stack: error.stack
                    }
                });
                // Fallback to empty string if conversion fails
                longTermMemory = '';
            }
        }

        // Prepare prompts with actual data
        const systemPrompt = prompts.PLANNER_SYSTEM.replace('{{toolsDescription}}', toolsDescription);
        const userPrompt = prompts.PLANNER_USER
            .replace('{{original_message}}', enrichedMessage.original_message)
            .replace('{{short_term_memory}}', shortTermMemory)
            .replace('{{long_term_memory}}', longTermMemory);

        const planningPrompts = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        logger.debug('handleBubble', 'Planning prompt messages being sent to OpenAI', { planningPrompts });

        // Emit subsystem message with the planning prompt
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'planner',
            content: {
                type: 'prompt',
                prompt: planningPrompts,
                message: enrichedMessage.original_message
            }
        });

        const planningResponse = await openai.chat(planningPrompts, {
            response_format: prompts.PLAN_SCHEMA,
            temperature: 0.7,
            max_tokens: 2000
        });

        // Delete response.response.raw.context before logging to debug (if the key exists)
        delete planningResponse.raw?.context;
        logger.debug('response', 'Received OpenAI response', {
            response: planningResponse
        });

        let plan;
        try {
            plan = JSON.parse(planningResponse.content).steps;
            logger.debug('parsed', 'Successfully parsed plan', {
                plan
            });
            
            // Emit subsystem message with the generated plan
            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'planner',
                content: {
                    type: 'plan',
                    plan: plan,
                    message: enrichedMessage.original_message
                }
            });
        } catch (parseError) {
            logger.debug('error', 'Failed to parse plan', {
                content: planningResponse.content,
                error: parseError.message
            });
            
            // Emit system error message
            await sharedEventEmitter.emit('systemError', {
                module: 'planner',
                content: {
                    type: 'system_error',
                    error: parseError.message,
                    stack: parseError.stack,
                    location: 'planner.parsePlan',
                    status: 'error'
                }
            });
            
            return {
                status: 'error',
                error: 'Failed to create a valid plan'
            };
        }

        logger.debug('plan', 'Generated plan', { plan });

        // Validate plan steps against available tools
        const toolNames = new Set(tools.map(t => t.name));
        const invalidSteps = plan.filter(step => !toolNames.has(step.tool));
        if (invalidSteps.length > 0) {
            logger.debug('error', 'Plan contains invalid tools', { invalidSteps });
            //output valid tools to debug log
            logger.debug('tools', 'Valid tools', {
                tools: tools.map(t => ({ name: t.name, description: t.description }))
            });

            return {
                status: 'error',
                error: `Plan contains invalid tools: ${invalidSteps.map(s => s.tool).join(', ')}`
            };
        }

        return {
            status: 'success',
            requiresTools: true,
            plan: JSON.stringify(plan)
        };

    } catch (error) {
        logger.debug('error', 'Planning process failed', {
            error: {
                message: error.message,
                stack: error.stack
            }
        });

        // Emit system error message
        await sharedEventEmitter.emit('systemError', {
            module: 'planner',
            content: {
                type: 'system_error',
                error: error.message,
                stack: error.stack,
                location: 'planner',
                status: 'error'
            }
        });

        return {
            status: 'error',
            error: error.message
        };
    }
}

/**
 * Formats the tools description for the planner prompt
 * @param {Array} tools - The available tools
 * @returns {string} - The formatted tools description
 */
function formatToolsDescription(tools) {
    return tools.map(tool => {
        const capabilities = tool.getCapabilities();
        return `${tool.name}: ${tool.description}
    Actions:${capabilities.actions.map(action => `
    - ${action.name}: ${action.description}
      Parameters:${action.parameters.map(param => `
      * ${param.name} (${param.type}${param.required ? ', required' : ''}): ${param.description}`).join('')}`).join('')}`;
    }).join('\n');
}

module.exports = { planner };

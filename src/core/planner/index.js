require('dotenv').config();
const { getOpenAIClient } = require('../../utils/openaiClient.js');
const toolManager = require('../../mcp');
const logger = require('../../utils/logger.js');
const memory = require('../memory');
const sharedEventEmitter = require('../../utils/eventEmitter');
const prompts = require('./prompts');
const { loadSettings } = require('../../utils/settings');
const fs = require('fs');
const path = require('path');

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
            longTermMemory = (await memory.retrieveLongTerm('ego', memoryQuery, shortTermMemory)) || '';
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

        const settings = loadSettings();
        const planningResponse = await openai.chat(planningPrompts, {
            model: settings.plannerModel || settings.llmModel,
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

/**
 * Creates a high-level strategic approach for solving the user's request
 * @param {Object} enrichedMessage - The enriched message containing the original message and memory
 * @param {Object} client - Optional client for OpenAI
 * @returns {Object} - The strategic planning result containing approach and success criteria
 */
async function strategicPlanner(enrichedMessage, client = null) {
    try {
        logger.debug('strategicPlanner', 'Starting strategic planning process', {
            message: enrichedMessage.original_message
        });
        
        await sharedEventEmitter.emit('systemStatusMessage', {
            message: 'Formulating strategic approach...',
            persistent: false
        });

        // Get high-level tool descriptions (names and descriptions only)
        const tools = await toolManager.getAllTools();
        const toolSummary = tools.map(tool => `${tool.name}: ${tool.description}`).join('\n');
        
        logger.debug('strategicPlanner', 'Tool summary prepared', { 
            toolCount: tools.length 
        });

        // Read memory models for context
        const selfModelPath = path.join(process.cwd(), 'data', 'self', 'models', 'self.md');
        const userModelPath = path.join(process.cwd(), 'data', 'self', 'models', 'user.md');
        const systemModelPath = path.join(process.cwd(), 'src', 'core', 'systemModel.md');
        
        let selfModel = 'No self model available.';
        let userModel = 'No user model available.';
        let systemModel = 'No system model available.';
        
        if (fs.existsSync(selfModelPath)) {
            selfModel = fs.readFileSync(selfModelPath, 'utf-8');
            logger.debug('strategicPlanner', 'Loaded self model', { 
                length: selfModel.length 
            });
        }
        
        if (fs.existsSync(userModelPath)) {
            userModel = fs.readFileSync(userModelPath, 'utf-8');
            logger.debug('strategicPlanner', 'Loaded user model', { 
                length: userModel.length 
            });
        }
        
        if (fs.existsSync(systemModelPath)) {
            systemModel = fs.readFileSync(systemModelPath, 'utf-8');
            logger.debug('strategicPlanner', 'Loaded system model', { 
                length: systemModel.length 
            });
        }
        
        // Use already-retrieved long-term memory instead of making another call
        const recentInteractions = enrichedMessage.context?.long_term_relevant_memory || 'No recent interactions found.';
        logger.debug('strategicPlanner', 'Using already-retrieved long-term memory', { 
            dataType: typeof recentInteractions,
            dataAvailable: recentInteractions !== 'No recent interactions found.' 
        });
        
        // First, determine execution mode using LLM-based decision
        const executionModeDecision = await determineExecutionMode({
            userQuery: enrichedMessage.original_message,
            shortTermMemory: enrichedMessage.context?.short_term_memory || {},
            longTermMemory: enrichedMessage.context?.long_term_relevant_memory || {},
            recentInteractions,
            selfModel,
            userModel
        });
        
        logger.debug('strategicPlanner', 'Execution mode determined', { executionModeDecision });
        
        // Emit subsystem message about execution mode decision
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'planner',
            content: {
                type: 'execution_mode_decision',
                mode: executionModeDecision.mode,
                reasoning: executionModeDecision.reasoning,
                confidence: executionModeDecision.confidence
            }
        });
        
        // If direct LLM execution is chosen, return early with execution mode flag
        if (executionModeDecision.mode === 'DIRECT_LLM') {
            logger.debug('strategicPlanner', 'Returning direct LLM execution mode');
            return {
                status: 'success',
                executionMode: 'DIRECT_LLM',
                reasoning: executionModeDecision.reasoning,
                confidence: executionModeDecision.confidence
            };
        }
        
        // Continue with full strategic planning for complex queries
        logger.debug('strategicPlanner', 'Proceeding with full strategic planning');
        
        // Format the strategic planning prompt
        const strategicUserPrompt = prompts.STRATEGIC_PLANNER_USER
            .replace('{{original_message}}', enrichedMessage.original_message)
            .replace('{{toolSummary}}', toolSummary)
            .replace('{{selfModel}}', selfModel)
            .replace('{{userModel}}', userModel)
            .replace('{{systemModel}}', systemModel)
            .replace('{{recentInteractions}}', 
                typeof recentInteractions === 'object' 
                ? JSON.stringify(recentInteractions, null, 2) 
                : recentInteractions);
        
        const strategicPrompts = [
            { role: 'system', content: prompts.STRATEGIC_PLANNER_SYSTEM },
            { role: 'user', content: strategicUserPrompt }
        ];

        logger.debug('strategicPlanner', 'Strategic planning prompt prepared');
        
        // Emit subsystem message with the planning prompt
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'planner',
            content: {
                type: 'strategic_prompt',
                prompt: strategicPrompts,
                message: enrichedMessage.original_message
            }
        });

        // Get settings for model configuration
        const settings = loadSettings();
        const strategicResponse = await openai.chat(strategicPrompts, {
            model: settings.strategicPlannerModel || settings.plannerModel || settings.llmModel,
            response_format: prompts.STRATEGY_SCHEMA,
            temperature: settings.strategicPlannerTemperature || 0.7,
            max_tokens: settings.strategicPlannerMaxTokens || 2000
        });

        logger.debug('strategicPlanner', 'Received strategic planning response');
        
        let strategy;
        try {
            strategy = JSON.parse(strategicResponse.content);
            logger.debug('strategicPlanner', 'Successfully parsed strategy', {
                approach: strategy.approach.substring(0, 100) + '...',
                criteriaCount: strategy.successCriteria.length,
                complexity: strategy.complexityAssessment
            });
            
            // Add maximum iterations from settings
            strategy.maxIterations = settings.maxREACTIterations || 10;
            
            // Emit subsystem message with the generated strategy
            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'planner',
                content: {
                    type: 'strategy',
                    strategy: strategy,
                    message: enrichedMessage.original_message
                }
            });
            
            // Store strategy in short-term memory
            await memory.storeShortTerm('current_strategy', JSON.stringify(strategy));
            
            return {
                status: 'success',
                strategy
            };
            
        } catch (parseError) {
            logger.error('strategicPlanner', 'Failed to parse strategy', {
                content: strategicResponse.content,
                error: parseError.message
            });
            
            // Emit system error message
            await sharedEventEmitter.emit('systemError', {
                module: 'planner',
                content: {
                    type: 'system_error',
                    error: parseError.message,
                    stack: parseError.stack,
                    location: 'strategicPlanner.parseStrategy',
                    status: 'error'
                }
            });
            
            return {
                status: 'error',
                error: 'Failed to create a valid strategy'
            };
        }

    } catch (error) {
        logger.error('strategicPlanner', 'Strategic planning process failed', {
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
                location: 'strategicPlanner',
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
 * Determines whether to use direct LLM execution or full planning
 * @param {Object} context - Context object with user query and memory
 * @returns {Promise<Object>} Decision object with mode, reasoning, and confidence
 */
async function determineExecutionMode(context) {
    try {
        const systemPrompt = prompts.EXECUTION_MODE_DECISION_SYSTEM;
        const userPrompt = prompts.EXECUTION_MODE_DECISION_USER
            .replace('{{user_query}}', context.userQuery)
            .replace('{{short_term_memory}}', JSON.stringify(context.shortTermMemory || {}, null, 2))
            .replace('{{long_term_memory}}', JSON.stringify(context.longTermMemory || {}, null, 2))
            .replace('{{recent_interactions}}', 
                typeof context.recentInteractions === 'object' 
                ? JSON.stringify(context.recentInteractions, null, 2) 
                : context.recentInteractions)
            .replace('{{self_model}}', context.selfModel || 'No self model available.')
            .replace('{{user_model}}', context.userModel || 'No user model available.');

        logger.debug('determineExecutionMode', 'Making LLM call for execution mode decision');

        const decisionPrompts = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        // Get settings for model configuration
        const settings = loadSettings();
        const response = await openai.chat(decisionPrompts, {
            model: settings.executionModeModel || settings.plannerModel || settings.llmModel || 'gpt-4.1-mini',
            temperature: 0.1,
            max_tokens: 500
        });

        const content = response.content.trim();
        logger.debug('determineExecutionMode', 'LLM response received', { content });

        // Parse the JSON response
        const decision = JSON.parse(content);
        
        // Validate the decision structure
        if (!decision.mode || !['DIRECT_LLM', 'FULL_PLANNING'].includes(decision.mode)) {
            throw new Error('Invalid execution mode decision');
        }

        return {
            mode: decision.mode,
            reasoning: decision.reasoning || 'No reasoning provided',
            confidence: decision.confidence || 0.5
        };

    } catch (error) {
        logger.debug('determineExecutionMode', 'Error determining execution mode, defaulting to FULL_PLANNING', {
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        
        // Default to full planning if decision fails
        return {
            mode: 'FULL_PLANNING',
            reasoning: 'Error in decision process, defaulting to full planning for safety',
            confidence: 0.5
        };
    }
}

module.exports = { planner, strategicPlanner };

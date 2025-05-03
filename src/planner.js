const { getOpenAIClient } = require('./utils/openaiClient.js');
require('dotenv').config();
const toolManager = require('./mcp');
const logger = require('./utils/logger.js');
const memory = require('./memory');
const sharedEventEmitter = require('./utils/eventEmitter');

const openai = getOpenAIClient();
async function planner(enrichedMessage, client = null) {
    try {
        logger.debug('start', 'Planning for message:', enrichedMessage);
        logger.debug('start', 'Starting planning process', {
            message: enrichedMessage.original_message,
            short_term_memory: enrichedMessage.short_term_memory
        });

        // Load available tools
        const tools = await toolManager.loadTools();
        logger.debug('tools', 'Loaded tools:', tools.map(t => t.name));
        logger.debug('tools', 'Available tools loaded', {
            tools: tools.map(t => ({ name: t.name, description: t.description }))
        });

        // Create a plan
        const toolsDescription = tools.map(tool => {
            const capabilities = tool.getCapabilities();
            return `${tool.name}: ${tool.description}
    Actions:${capabilities.actions.map(action => `
    - ${action.name}: ${action.description}
      Parameters:${action.parameters.map(param => `
      * ${param.name} (${param.type}${param.required ? ', required' : ''}): ${param.description}`).join('')}`).join('')}`;
        }).join('\n');

        const planningPrompts = [
            {
                role: 'system',
                content: `You are an expert task planner. Your role is to break down complex tasks into a series of concrete steps that can be executed using available tools. You must respond with valid JSON.

Available tools:
${toolsDescription}

Remember:
1. Each step should be atomic and achievable with a single tool action
2. Steps should be ordered logically
3. Include all necessary parameters for each tool action
4. Be specific and concrete in descriptions
5. Only use appropriate tools from the list of possible tools. You don't need to use all available tools.`
            },
            { role: 'user', content: `Request: "${enrichedMessage.original_message}"\n
            Create a plan using the available tools.
            Relevant short-term memory: ${enrichedMessage.short_term_memory}
            Relevant long-term memory: ${enrichedMessage.long_term_memory}
            ` }
        ];

        logger.debug('handleBubble', 'Planning prompt messages being sent to OpenAI', { planningPrompts });

        const planningResponse = await openai.chat(planningPrompts, {
            response_format: {
                "type": "json_schema",
                "json_schema": {
                    "name": "plan",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "steps": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "tool": { "type": "string" },
                                        "action": { "type": "string" }, 
                                        "parameters": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "name": { "type": "string" },
                                                    "value": { "type": "string" }
                                                },
                                                "required": ["name", "value"],
                                                "additionalProperties": false
                                            }
                                        },
                                        "description": { "type": "string" },
                                    },
                                    "required": ["tool", "action", "parameters", "description"],
                                    "additionalProperties": false
                                }
                            }
                        },
                        "required": ["steps"],
                        "additionalProperties": false
                    },
                    "strict": true
                }
            },
            temperature: 0.7,
            max_tokens: 2000
        });

        //delete response.response.raw.context before logging to debug (if the key exists)
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

        return {
            status: 'error',
            error: error.message
        };
    }
}

module.exports = { planner };

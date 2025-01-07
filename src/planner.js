const { getOpenAIClient } = require('./utils/openaiClient.js');
require('dotenv').config();
const toolManager = require('./tools');
const logger = require('./utils/logger.js');
const memory = require('./memory');

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
        await memory.storeShortTerm('Tools loaded', {
            tools: tools.map(t => ({ name: t.name, description: t.description }))
        });

        // Create a plan
        const planningPrompt = `You are a task planner that creates plans using available tools.
Available tools and their actions:
${tools.map(tool => {
            const capabilities = tool.getCapabilities();
            return `${tool.name}: ${tool.description}
    Actions:${capabilities.actions.map(action => `
    - ${action.name}: ${action.description}
      Parameters:${action.parameters.map(param => `
      * ${param.name} (${param.type}${param.required ? ', required' : ''}): ${param.description}`).join('')}`).join('')}`;
        }).join('\n')}

Create a plan containing ALL steps to handle the user's request. The plan should:
1. Use the most appropriate tool(s) and action(s)
2. Include all required parameters for each action
3. Return as a JSON array of ALL planned steps (only return JSON, do not include any other text outside of the JSON array), where each step has:
   - tool: name of the tool to use
   - action: name of the action to take
   - parameters: object with required parameters (even if only a single parameter, it should still be a sub-key of parameters object)
   - description: human readable description of the step

   Your response MUST:
- Start with [ and end with ]
- Contain at least 2 steps to show complete action sequence
- Be a valid JSON array even for single actions

   `;

        const planningPrompts = [
            { role: 'system', content: planningPrompt },
            { role: 'user', content: `Request: "${enrichedMessage.original_message}"\nCreate a plan using the available tools.` }
        ];

        logger.debug('handleBubble', 'Planning prompt messages being sent to OpenAI', { planningPrompts });

        const planningResponse = await openai.chat.completions.create({
            model: 'gpt-4o',
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
            messages: planningPrompts,
            temperature: 0.3,
            max_tokens: 1000
        });

        logger.debug('response', 'Received OpenAI response', {
            response: planningResponse
        });

        let plan;
        try {
            plan = JSON.parse(planningResponse.choices[0].message.content).steps;
            logger.debug('parsed', 'Successfully parsed plan', {
                plan
            });
        } catch (parseError) {
            logger.debug('error', 'Failed to parse plan', {
                content: planningResponse.choices[0].message.content,
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

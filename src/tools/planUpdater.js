const logger = require('../utils/logger.js');
const memory = require('../core/memory');
const { getOpenAIClient } = require("../utils/openaiClient.js");
const { loadSettings } = require("../utils/settings");

class PlanUpdaterTool {
    constructor() {
        this.name = 'planUpdater';
        this.description = 'Tool for updating plans based on results of prior steps. Usually used to update action parameters of future steps based on outputs of previous steps. Should not be the last step in a plan as it assumes there will be later steps to update.';
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'evalForUpdate',
                    description: 'Evaluate the results from the steps prior, and if necessary update later step parameters with any relevant outputs from earlier steps. Use this step immediately after a step that wil produce outputs needed for future planned steps',
                    parameters: [
                        {
                            name: 'currentStepNumber',
                            description: 'The current step number in the plan being executed. Numbering starts at 0',
                            type: 'number',
                            required: true
                        }
                    ]
                }
            ]
        };
    }

    async reeval(currentStepNumber, plan) {
        logger.debug('planUpdater', 'Re-evaluating plan at step:', currentStepNumber);
        
        // Get current context from memory
        const shortTermMemory = await memory.retrieveShortTerm();
        
        // Build prompt for OpenAI
        const prompt = `Current Plan: ${JSON.stringify(plan)}
                Current Step: ${currentStepNumber}
                Execution History: ${JSON.stringify(shortTermMemory)}
                
                Please analyze this plan and determine if it needs updating. Pay special attention to:
                - Dependencies between steps
                - Required inputs that will be generated in previous steps
                - Any conflicts or issues based on the execution history`;

        const messages = [
            {
                role: 'system',
                content: `You are a plan evaluator and updater. Your role is to assess whether a plan needs updating based on new information and execution results. You must respond with valid JSON.

Remember:
1. Only suggest updates if truly necessary
2. Consider both success and failure scenarios
3. Maintain consistency with original goals
4. Be specific about why updates are needed`
            },
            {
                role: 'user',
                content: prompt
            }
        ];

        try {
            const openai = getOpenAIClient();
            const settings = loadSettings();
            const response = await openai.chat(messages, {
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "evaluation",
                        schema: {
                            type: "object",
                            properties: {
                                needs_update: {
                                    type: "boolean",
                                    description: "Indicates whether the plan needs to be updated"
                                },
                                reason: {
                                    type: "string",
                                    description: "Explanation of why the plan needs updating (if it does)"
                                },
                                updated_plan: {
                                    type: "object",
                                    properties: {
                                        steps: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    tool: { type: "string" },
                                                    action: { type: "string" },
                                                    parameters: {
                                                        type: "array",
                                                        items: {
                                                            type: "object",
                                                            properties: {
                                                                name: { type: "string" },
                                                                value: { type: "string" }
                                                            },
                                                            required: ["name", "value"],
                                                            additionalProperties: false
                                                        }
                                                    },
                                                    description: { type: "string" }
                                                },
                                                required: ["tool", "action", "parameters", "description"],
                                                additionalProperties: false
                                            }
                                        }
                                    },
                                    required: ["steps"],
                                    additionalProperties: false
                                },
                                next_step_index: {
                                    type: "integer",
                                    description: "0-based index of the next step to execute"
                                }
                            },
                            required: ["needs_update", "reason", "updated_plan", "next_step_index"],
                            additionalProperties: false
                        },
                        strict: true
                    }
                },
                temperature: 0.7,
                max_tokens: settings.maxTokens || 1000
            });

            const evaluation = JSON.parse(response.content);
            
            logger.debug('PlanUpdaterTool', 'Evaluation for update result:', evaluation);

            if (evaluation.needs_update) {
                return {
                    status: 'replan',
                    message: evaluation.reason,
                    updatedPlan: evaluation.updated_plan,
                    nextStepIndex: evaluation.next_step_index
                };
            }

            return {
                status: 'success',
                message: 'Plan is valid and can continue execution',
                nextStepIndex: evaluation.next_step_index
            };

        } catch (error) {
            logger.debug('PlanUpdaterTool', 'Error during plan re-evaluation:', error);
            throw new Error(`Plan re-evaluation failed: ${error.message}`);
        }
    }

    async execute(action, parameters, plan) {
        logger.debug('PlanUpdaterTool executing:', { action, parameters, plan });
        
        try {
            switch (action) {
                case 'evalForUpdate': {
                    const currentStepNumber = parameters.find(p => p.name === 'currentStepNumber')?.value;
                    
                    if (currentStepNumber === undefined) {
                        throw new Error('Missing required parameter: currentStepNumber');
                    }
                    if (!plan) {
                        throw new Error('Missing required plan parameter');
                    }

                    return await this.reeval(currentStepNumber, plan);
                }
                    
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            logger.debug('PlanUpdaterTool', 'Execution error:', error);
            return {
                status: 'error',
                error: error.message
            };
        }
    }
}

module.exports = new PlanUpdaterTool();

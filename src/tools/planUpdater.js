const logger = require('../utils/logger.js');
const memory = require('../memory.js');
const { getOpenAIClient } = require("../utils/openaiClient.js");

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
        const messages = [
            {
                role: 'system',
                content: `You are a plan evaluation assistant. Your job is to:
                1. Analyze the current plan and execution state
                2. Identify any dependencies or conflicts
                3. Determine if the plan needs updating
                4. If needed, provide an updated plan with the next step to execute
                
                Return your response as a JSON object with the following structure:
                {
                    "needs_update": boolean,
                    "reason": string,
                    "updated_plan": object (only if needs_update is true),
                    "next_step_index": number (this should be the index of the next step to execute, the one immediately after the current planUpdate step. Index beings at 0)
                }`
            },
            {
                role: 'user',
                content: `Current Plan: ${JSON.stringify(plan)}
                Current Step: ${currentStepNumber}
                Execution History: ${JSON.stringify(shortTermMemory)}
                
                Please analyze this plan and determine if it needs updating. Pay special attention to:
                - Dependencies between steps
                - Required inputs that will be generated in previous steps
                - Any conflicts or issues based on the execution history`
            }
        ];

        try {
            const openai = getOpenAIClient();
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: messages,
                response_format: {
                    type: "json_schema",
                    json_schema: {
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
                        required: ["needs_update", "reason", "next_step_index"],
                        additionalProperties: false
                    }
                },
                temperature: 0.2, // Low temperature for more consistent logical analysis
                max_tokens: 1500,
                response_format: { type: "json_object" }
            });

            const evaluation = JSON.parse(response.choices[0].message.content);
            
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
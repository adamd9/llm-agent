const logger = require('../utils/logger.js');
const memory = require('../core/memory');
const { getOpenAIClient } = require("../utils/openaiClient.js");
const { loadSettings } = require("../utils/settings");
const { planner } = require("../core/planner");
const sharedEventEmitter = require('../utils/eventEmitter');

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

    async reeval(currentStepNumber, plan, results = []) {
        logger.debug('PlanUpdaterTool', 'Re-evaluating plan', { currentStepNumber, plan });
        
        // Get short-term memory to provide context
        const shortTermMemory = await memory.retrieveShortTerm() || [];
        
        // Format previous outputs for context
        let previousOutputs = [];
        if (Array.isArray(results) && results.length > 0) {
            previousOutputs = results.slice(0, currentStepNumber).map((r, idx) => ({
                step: idx,
                tool: r.tool,
                action: r.action,
                output: r.result
            }));
        }

        // Create an enriched message for the planner
        const enrichedMessage = {
            original_message: `Re-evaluate the current plan based on execution results. 
            Current Step: ${currentStepNumber}
            Previous Step Outputs: ${JSON.stringify(previousOutputs)}
            Current Plan: ${JSON.stringify(plan)}
            
            Determine if the plan needs updating based on these results. If it does, provide an updated plan.`,
            context: {
                short_term_memory: shortTermMemory
            }
        };
        
        // Emit subsystem message about replanning
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'planUpdater',
            content: {
                type: 'replanning',
                currentStep: currentStepNumber,
                previousResults: previousOutputs.length
            }
        });

        try {
            // Use the existing planner to generate a new plan
            logger.debug('PlanUpdaterTool', 'Calling planner with enriched message');
            const planResult = await planner(enrichedMessage);
            logger.debug('PlanUpdaterTool', 'Planner result:', planResult);
            
            if (planResult.status === 'error') {
                logger.error('PlanUpdaterTool', 'Planner error:', planResult.error);
                return {
                    status: 'error',
                    error: planResult.error,
                    message: `Plan re-evaluation failed: ${planResult.error}`
                };
            }
            
            // Parse the new plan
            const newPlan = JSON.parse(planResult.plan);
            
            // Compare old and new plans to determine if an update is needed
            const oldPlanStr = JSON.stringify(plan);
            const newPlanStr = JSON.stringify(newPlan);
            const needsUpdate = oldPlanStr !== newPlanStr;
            
            if (needsUpdate) {
                logger.debug('PlanUpdaterTool', 'Plan update needed', {
                    oldPlanLength: plan.length,
                    newPlanLength: newPlan.length
                });
                
                return {
                    status: 'replan',
                    message: 'Plan updated based on execution results',
                    updatedPlan: {
                        steps: newPlan
                    },
                    nextStepIndex: currentStepNumber
                };
            }
            
            return {
                status: 'success',
                message: 'Plan is valid and can continue execution',
                nextStepIndex: currentStepNumber
            };

        } catch (error) {
            logger.debug('PlanUpdaterTool', 'Error during plan re-evaluation:', error);
            throw new Error(`Plan re-evaluation failed: ${error.message}`);
        }
    }

    async execute(action, parameters, plan, results = []) {
        logger.debug('PlanUpdaterTool executing:', { action, parameters, plan, results });
        
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

                    return await this.reeval(currentStepNumber, plan, results);
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

require('dotenv').config();
const { getOpenAIClient } = require('../../utils/openaiClient.js');
const toolManager = require('../../mcp'); // Updated to use MCP tool manager
const logger = require('../../utils/logger');
const sharedEventEmitter = require('../../utils/eventEmitter');
const memory = require('../memory');
const prompts = require('../planner/prompts');
const { loadSettings } = require('../../utils/settings');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const fsPromises = fs.promises;

const openai = getOpenAIClient();

/**
 * Coordinates the execution of a task using a strategy-guided REACT approach
 * @param {Object} enrichedMessage - The enriched message containing the strategy
 * @returns {Object} - The result of the task execution
 */
async function coordinator(enrichedMessage) {
    try {
        logger.debug('coordinator', 'Starting strategy-guided coordination', {
            message: enrichedMessage.original_message
        });
        
        // Get the strategy from the message context
        const strategy = enrichedMessage.strategy || null;
        logger.debug('coordinator', 'Using strategy', { strategy });
        
        if (!strategy) {
            logger.error('coordinator', 'No strategy provided');
            return {
                status: 'error',
                error: 'No strategy provided',
                stack: new Error('No strategy provided').stack,
                details: {
                    error: 'No strategy provided',
                    stack: new Error('No strategy provided').stack
                }
            };
        }
        
        await sharedEventEmitter.emit('systemStatusMessage', {
            message: 'Starting task execution...',
            persistent: false
        });
        
        // Log the strategy being used
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'coordinator',
            content: {
                type: 'strategy',
                strategy: strategy,
                message: enrichedMessage.original_message
            }
        });
        
        // Execute the strategy using REACT approach
        const result = await executeREACT(enrichedMessage, strategy);
        logger.debug('coordinator', 'Task execution result', { result });
        
        return result;
        
    } catch (error) {
        logger.error('coordinator', 'Coordination failed', {
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        
        // Emit system error message
        await sharedEventEmitter.emit('systemError', {
            module: 'coordinator',
            content: {
                type: 'system_error',
                error: error.message,
                stack: error.stack,
                location: 'coordinator',
                status: 'error'
            }
        });
        
        return {
            status: 'error',
            error: error.message,
            stack: error.stack,
            details: {
                error: error.message,
                stack: error.stack
            }
        };
    }
}

/**
 * Executes a task using a REACT (Reason + Act) approach guided by a strategic plan
 * @param {Object} enrichedMessage - The enriched message containing the original message and context
 * @param {Object} strategy - The strategic plan to guide execution
 * @returns {Object} - The result of the task execution
 */
async function executeREACT(enrichedMessage, strategy) {
    try {
        const settings = loadSettings();
        const maxIterations = strategy.maxIterations || settings.maxREACTIterations || 10;
        logger.debug('executeREACT', 'Starting REACT execution loop', { 
            maxIterations, 
            complexity: strategy.complexityAssessment 
        });
        
        // console.log(`[REACT] Starting execution with max ${maxIterations} iterations, complexity: ${strategy.complexityAssessment}`);
        
        // Emit status message about complexity assessment
        await sharedEventEmitter.emit('systemStatusMessage', {
            message: `Task complexity: ${strategy.complexityAssessment}`,
            persistent: false
        });
        
        // Initialize execution state
        const executionResults = [];
        let currentStep = null;
        let stepResult = null;
        let iterationCount = 0;
        let isComplete = false;

        // For simple tasks, we might execute just one step
        const isSimpleTask = strategy.complexityAssessment === 'Simple';
        
        // Cache tools for execution
        const tools = await toolManager.getAllTools();
        logger.debug('executeREACT', 'Tools loaded', { count: tools.length });
        const toolMap = new Map(tools.map(tool => [tool.name, tool]));
        
        // Helper function to format previous steps for context
        const formatPreviousSteps = () => {
            if (executionResults.length === 0) return 'No previous steps executed yet.';
            
            return executionResults.map((result, index) => {
                return `Step ${index + 1}:\n` +
                       `Reasoning: ${result.step.reasoning}\n` +
                       `Action: ${result.step.tool ? `${result.step.tool}.${result.step.action}` : 'None'}\n` +
                       `Parameters: ${result.step.parameters ? JSON.stringify(result.step.parameters) : 'None'}\n` +
                       `Result: ${typeof result.result === 'object' ? JSON.stringify(result.result) : result.result}\n`;
            }).join('\n');
        };
        
        // Get memory context for step planning
        let shortTermMemory = enrichedMessage.context?.short_term_memory;
        if (!shortTermMemory) {
            shortTermMemory = await memory.retrieveShortTerm() || '';
        }
        
        let longTermMemory = enrichedMessage.context?.long_term_relevant_memory;
        if (!longTermMemory) {
            const memoryQuery = `Retrieve information relevant to: ${enrichedMessage.original_message}`;
            longTermMemory = (await memory.retrieveLongTerm('ego', memoryQuery, shortTermMemory)) || '';
        }
        
        // Ensure memory values are strings
        if (typeof shortTermMemory === 'object') {
            shortTermMemory = JSON.stringify(shortTermMemory, null, 2);
        }
        
        if (typeof longTermMemory === 'object') {
            longTermMemory = JSON.stringify(longTermMemory, null, 2);
        }

        // Store strategy in short-term memory
        await memory.storeShortTerm('CurrentStrategy', JSON.stringify(strategy), 'coordinator');
        await memory.storeShortTerm('CurrentStrategy', JSON.stringify(strategy), 'ego');
        
        // Format tools description for step planning
        const toolsDescription = tools.map(tool => {
            const capabilities = tool.getCapabilities();
            return `${tool.name}: ${tool.description}
    Actions:${capabilities.actions.map(action => `
    - ${action.name}: ${action.description}
      Parameters:${action.parameters.map(param => `
      * ${param.name} (${param.type}${param.required ? ', required' : ''}): ${param.description}`).join('')}`).join('')}`;
        }).join('\n');

        // Begin REACT execution loop
        while (!isComplete && iterationCount < maxIterations) {
            iterationCount++;
            
            await sharedEventEmitter.emit('systemStatusMessage', {
                message: `Executing step ${iterationCount}...`,
                persistent: false
            });
            
            // Step 1: Plan the next step
            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'coordinator',
                content: {
                    type: 'status',
                    message: 'Planning next step...',
                    iteration: iterationCount
                }
            });
            
            // console.log(`[REACT] Planning next step for iteration ${iterationCount}`);
            
            // Get planned step
            currentStep = await planNextStep(
                enrichedMessage.original_message, 
                strategy, 
                formatPreviousSteps(), 
                toolsDescription,
                shortTermMemory,
                longTermMemory
            );
            
            // Log the planned step
            logger.debug('executeREACT', 'Planned step', { 
                currentStep,
                action: currentStep.action,
                status: currentStep.status 
            });
            
            // Log detailed iteration information
            logger.debug('executeREACT', `REACT Iteration ${iterationCount}/${maxIterations}`, {
                iterationCount,
                maxIterations,
                stepStatus: currentStep.status,
                tool: currentStep.tool || 'none',
                action: currentStep.action || 'none'
            });
            
            // Check if task is complete
            if (currentStep.status === 'complete') {
                isComplete = true;
                
                logger.debug('executeREACT', 'Task marked as complete', { 
                    reasoning: currentStep.reasoning 
                });
                
                await sharedEventEmitter.emit('systemStatusMessage', {
                    message: 'Task completed successfully!',
                    persistent: false
                });
                
                // Add final reasoning to execution results
                executionResults.push({
                    step: currentStep,
                    result: 'Task completed.'
                });
                
                break;
            }
            
            // Execute the step if we have a tool
            if (currentStep.tool) {
                await sharedEventEmitter.emit('systemStatusMessage', {
                    message: `Executing: ${currentStep.tool}.${currentStep.action}`,
                    persistent: false
                });
                
                const tool = toolMap.get(currentStep.tool);
                
                if (!tool) {
                    logger.error('executeREACT', 'Tool not found', { 
                        tool: currentStep.tool 
                    });
                    
                    // Emit system error message
                    await sharedEventEmitter.emit('systemError', {
                        module: 'coordinator',
                        content: {
                            type: 'system_error',
                            error: `Tool not found: ${currentStep.tool}`,
                            location: 'executeREACT',
                            status: 'error'
                        }
                    });
                    
                    return {
                        status: 'error',
                        error: `Tool not found: ${currentStep.tool}`,
                        details: {
                            error: `Tool not found: ${currentStep.tool}`,
                            lastStep: currentStep
                        }
                    };
                }
                
                try {
                    // Log the parameters for debugging
                    logger.debug('executeREACT', 'Tool parameters', { parameters: currentStep.parameters });
                    
                    // Execute the tool action with properly formatted parameters
                    if (currentStep.action === 'ask' && currentStep.tool === 'question') {
                        // Special handling for question tool which expects a specific parameter format
                        const questionParam = currentStep.parameters?.find(p => p.name === 'query');
                        const questionValue = questionParam ? questionParam.value : 'I need more information to proceed. Could you provide additional details?';
                        
                        stepResult = await tool.execute(
                            currentStep.action, 
                            [{ name: 'question', value: questionValue }], 
                            null, 
                            executionResults.map(r => ({
                                tool: r.step.tool,
                                action: r.step.action,
                                result: r.result
                            }))
                        );
                    } else {
                        // Standard parameter handling for other tools
                        stepResult = await tool.execute(
                            currentStep.action, 
                            currentStep.parameters || [], 
                            null, // No full plan in REACT model
                            executionResults.map(r => ({
                                tool: r.step.tool,
                                action: r.step.action,
                                result: r.result
                            }))
                        );
                    }
                    
                    logger.debug('executeREACT', 'Tool execution result', { 
                        status: stepResult.status 
                    });
                    
                    await sharedEventEmitter.emit('subsystemMessage', {
                        module: 'tools',
                        content: { 
                            type: 'tool_execution', 
                            tool: currentStep.tool, 
                            action: currentStep.action, 
                            result: stepResult 
                        }
                    });
                    
                    // Check for error in step execution
                    if (stepResult.status === 'error') {
                        logger.error('executeREACT', 'Tool execution error', { 
                            error: stepResult.error 
                        });
                        
                        await sharedEventEmitter.emit('systemStatusMessage', {
                            message: `Error: ${stepResult.error}`,
                            persistent: false
                        });
                        
                        return {
                            status: 'error',
                            error: stepResult.error,
                            details: {
                                error: stepResult.error,
                                lastStep: currentStep,
                                toolResponse: stepResult
                            }
                        };
                    }
                    
                } catch (error) {
                    logger.error('executeREACT', 'Step execution error', {
                        error: {
                            message: error.message,
                            stack: error.stack
                        }
                    });
                    
                    await sharedEventEmitter.emit('systemError', {
                        module: 'coordinator',
                        content: {
                            type: 'system_error',
                            error: error.message,
                            stack: error.stack,
                            location: 'executeREACT.executeStep',
                            status: 'error'
                        }
                    });
                    
                    return {
                        status: 'error',
                        error: error.message,
                        stack: error.stack,
                        details: {
                            error: error.message,
                            stack: error.stack,
                            lastStep: currentStep
                        }
                    };
                }
            } else {
                // No tool to execute, this step is just reasoning
                stepResult = { status: 'success', message: 'Reasoning step, no tool execution required.' };
            }
            
            // Add step and result to execution results
            executionResults.push({
                step: currentStep,
                result: stepResult
            });
            
            // For simple tasks, we might just need one step
            if (isSimpleTask && iterationCount === 1) {
                // Evaluate whether the simple task is already complete
                const evaluation = await evaluateStep(
                    enrichedMessage.original_message,
                    strategy,
                    currentStep,
                    stepResult
                );
                
                if (evaluation.isOnTrack && evaluation.confidence > 0.8) {
                    logger.debug('executeREACT', 'Simple task completed in first step', {
                        evaluation
                    });
                    
                    isComplete = true;
                    await sharedEventEmitter.emit('systemStatusMessage', {
                        message: 'Simple task completed in single step',
                        persistent: false
                    });
                    break;
                }
            }
            
            // If we've reached max iterations, log and break
            if (iterationCount >= maxIterations) {
                logger.debug('executeREACT', 'Reached maximum iterations', { 
                    maxIterations 
                });
                
                // console.log(`[REACT] Reached maximum iterations (${maxIterations})`);
                
                await sharedEventEmitter.emit('systemStatusMessage', {
                    message: `Reached maximum iterations (${maxIterations})`,
                    persistent: false
                });
                break;
            }
        } // End of REACT loop
        
        // Log and return the final execution results
        logger.debug('executeREACT', 'Execution completed', { 
            iterations: iterationCount, 
            isComplete, 
            resultCount: executionResults.length 
        });
        
        // Store results in short-term memory
        await memory.storeShortTerm('LatestExecutionResults', JSON.stringify(executionResults), 'coordinator');
        
        // Emit subsystem message with execution results
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'coordinator',
            content: {
                type: 'execution_results',
                results: executionResults,
                status: isComplete ? 'complete' : 'incomplete'
            }
        });
        
        return {
            status: 'success',
            response: executionResults,
            isComplete,
            iterations: iterationCount
        };
        
    } catch (error) {
        logger.error('executeREACT', 'REACT execution failed', {
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        
        // Emit system error message
        await sharedEventEmitter.emit('systemError', {
            module: 'coordinator',
            content: {
                type: 'system_error',
                error: error.message,
                stack: error.stack,
                location: 'executeREACT',
                status: 'error'
            }
        });
        
        return {
            status: 'error',
            error: error.message,
            stack: error.stack,
            details: {
                error: error.message,
                stack: error.stack
            }
        };
    }
}

/**
 * Plans the next step based on the strategy and previous results
 * @param {string} message - The original user message
 * @param {Object} strategy - The strategic plan
 * @param {string} previousSteps - Formatted string of previous steps and results
 * @param {string} toolsDescription - Formatted string of available tools
 * @param {string} shortTermMemory - Short-term memory content
 * @param {string} longTermMemory - Long-term memory content
 * @returns {Object} - The next step to execute
 */
async function planNextStep(message, strategy, previousSteps, toolsDescription, shortTermMemory, longTermMemory) {
    try {
        logger.debug('planNextStep', 'Planning next step');
        
        // Limit the size of previous steps to avoid token limit issues
        // Keep only the last 3 steps if the string is too long
        let limitedPreviousSteps = previousSteps;
        if (previousSteps.length > 2000) {
            const steps = previousSteps.split('\n\n');
            const lastSteps = steps.slice(Math.max(0, steps.length - 3)).join('\n\n');
            limitedPreviousSteps = `[...${steps.length - 3} earlier steps omitted...]\n\n${lastSteps}`;
        }
        
        // Limit memory content size
        const limitedShortTermMemory = shortTermMemory.length > 1000 ? 
            shortTermMemory.substring(0, 1000) + '...[truncated]' : shortTermMemory;
        const limitedLongTermMemory = longTermMemory.length > 1000 ? 
            longTermMemory.substring(0, 1000) + '...[truncated]' : longTermMemory;

        // Format the step planning prompt
        const stepUserPrompt = prompts.STEP_PLANNER_USER
            .replace('{{original_message}}', message)
            .replace('{{strategy.approach}}', strategy.approach)
            .replace('{{strategy.successCriteria}}', strategy.successCriteria.join('\n'))
            .replace('{{previousSteps}}', limitedPreviousSteps)
            .replace('{{short_term_memory}}', limitedShortTermMemory)
            .replace('{{long_term_memory}}', limitedLongTermMemory);
        
        const stepSystemPrompt = prompts.STEP_PLANNER_SYSTEM
            .replace('{{toolsDescription}}', toolsDescription);
        
        const stepPrompts = [
            { role: 'system', content: stepSystemPrompt },
            { role: 'user', content: stepUserPrompt }
        ];
        
        // Emit subsystem message with the step planning prompt
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'coordinator',
            content: {
                type: 'step_planning_prompt',
                prompt: stepPrompts
            }
        });
        
        // Get settings for model configuration
        const settings = loadSettings();
        const stepResponse = await openai.chat(stepPrompts, {
            model: settings.stepPlannerModel || settings.plannerModel || settings.llmModel,
            response_format: prompts.STEP_SCHEMA,
            temperature: settings.stepPlannerTemperature || 0.4,
            max_tokens: settings.stepPlannerMaxTokens || 1500
        });
        
        logger.debug('planNextStep', 'Received step planning response');
        
        try {
            const step = JSON.parse(stepResponse.content);

            
            
            // If step status is 'complete', ensure all required fields have default values
            // This is needed because OpenAI schema validation requires all fields in 'required'
            if (step.status === 'complete') {
                // Provide default values for required fields if not present
                step.tool = step.tool || 'none';
                step.action = step.action || 'none';
                step.parameters = step.parameters || [];
                step.description = step.description || 'Task completed successfully';
            }
            
            // Validate and fix tool name if necessary
            // The planner sometimes generates invalid tool names like 'query' instead of 'llmquery'
            if (step.status === 'in_progress') {
                // Common tool name corrections
                const toolCorrections = {
                    'query': 'llmquery',
                    'search': 'llmquery',
                    'internet': 'llmquery',
                    'ask': 'question',
                    'answer': 'question'
                };
                
                // Apply corrections if needed
                if (toolCorrections[step.tool]) {
                    logger.debug('planNextStep', `Correcting tool name from '${step.tool}' to '${toolCorrections[step.tool]}'`);
                    step.tool = toolCorrections[step.tool];
                }
            }
            
            // Emit subsystem message with the planned step
            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'coordinator',
                content: {
                    type: 'planned_step',
                    step: step
                }
            });
            
            return step;
            
        } catch (parseError) {
            logger.error('planNextStep', 'Failed to parse step', {
                content: stepResponse.content,
                error: parseError.message
            });
            
            // Return a basic error step
            return {
                status: 'in_progress',
                reasoning: 'Error parsing step plan: ' + parseError.message,
                tool: 'question',
                action: 'ask',
                parameters: [
                    { name: 'query', value: 'I encountered an error in my planning process. Let me try again with a simpler approach.' }
                ],
                description: 'Error recovery step'
            };
        }
        
    } catch (error) {
        logger.error('planNextStep', 'Step planning failed', {
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        
        // Return a basic error step
        return {
            status: 'in_progress',
            reasoning: 'Error in planning: ' + error.message,
            tool: 'question',
            action: 'ask',
            parameters: [
                { name: 'query', value: 'I encountered an error in my planning process. Could you please rephrase your request?' }
            ],
            description: 'Error recovery step'
        };
    }
}

/**
 * Evaluates if the step execution result is making progress toward the success criteria
 * @param {string} message - The original user message
 * @param {Object} strategy - The strategic plan
 * @param {Object} step - The step that was executed
 * @param {Object} stepResult - The result of the step execution
 * @returns {Object} - The evaluation result
 */
async function evaluateStep(message, strategy, step, stepResult) {
    try {
        logger.debug('evaluateStep', 'Evaluating step result');
        
        // Format the evaluation prompt
        const evaluationUserPrompt = prompts.EVALUATOR_USER
            .replace('{{original_message}}', message)
            .replace('{{strategy.approach}}', strategy.approach)
            .replace('{{strategy.successCriteria}}', strategy.successCriteria.join('\n'))
            .replace('{{step.description}}', step.description || (step.reasoning + (step.tool ? ' - ' + step.tool + '.' + step.action : '')))
            .replace('{{stepResult}}', typeof stepResult === 'object' ? JSON.stringify(stepResult, null, 2) : stepResult);
        
        const evaluationPrompts = [
            { role: 'system', content: prompts.EVALUATOR_SYSTEM },
            { role: 'user', content: evaluationUserPrompt }
        ];
        
        // Emit subsystem message with the evaluation prompt
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'coordinator',
            content: {
                type: 'evaluation_prompt',
                prompt: evaluationPrompts
            }
        });
        
        // Get settings for model configuration
        const settings = loadSettings();
        const evaluationResponse = await openai.chat(evaluationPrompts, {
            model: settings.evaluatorModel || settings.llmModel,
            response_format: prompts.EVALUATION_SCHEMA,
            temperature: settings.evaluatorTemperature || 0.3,
            max_tokens: settings.evaluatorMaxTokens || 1000
        });
        
        logger.debug('evaluateStep', 'Received evaluation response');
        
        try {
            const evaluation = JSON.parse(evaluationResponse.content);
            
            // Emit subsystem message with the evaluation
            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'coordinator',
                content: {
                    type: 'step_evaluation',
                    evaluation: evaluation
                }
            });
            
            return evaluation;
            
        } catch (parseError) {
            logger.error('evaluateStep', 'Failed to parse evaluation', {
                content: evaluationResponse.content,
                error: parseError.message
            });
            
            // Return a default evaluation
            return {
                isOnTrack: false,
                confidence: 0.5,
                reasoning: 'Error parsing evaluation: ' + parseError.message,
                suggestions: 'Continue with the next step in the plan.'
            };
        }
    } catch (error) {
        logger.error('evaluateStep', 'Step evaluation failed', {
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        
        // Return a default evaluation
        return {
            isOnTrack: false,
            confidence: 0.5,
            reasoning: 'Error in evaluation: ' + error.message,
            suggestions: 'Continue with the next step in the plan.'
        };
    }
}

module.exports = { coordinator, executeREACT, planNextStep, evaluateStep };

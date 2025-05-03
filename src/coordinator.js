const toolManager = require('./mcp'); // Updated to use MCP tool manager
const logger = require('./utils/logger');
const sharedEventEmitter = require('./utils/eventEmitter');
const memory = require('./memory');
async function coordinator(enrichedMessage) {
    try {
        logger.debug('Starting coordination', enrichedMessage.original_message);

        try {
            // Get the plan from the message context
            const plan = enrichedMessage.plan ? JSON.parse(enrichedMessage.plan) : null;
            logger.debug('Parsed plan:', plan);

            if (!plan) {
                logger.debug('No plan provided');
                return {
                    status: 'error',
                    error: 'No plan provided',
                    stack: new Error('No plan provided').stack,
                    details: {
                        error: 'No plan provided',
                        stack: new Error('No plan provided').stack
                    }
                };
            }

            logger.debug('Executing plan:', plan);
            const result = await executePlan(plan);
            logger.debug('Plan execution result:', result);
            return result;

        } catch (error) {
            logger.debug('Coordination failed', error);
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

    } catch (error) {
        logger.debug('Coordination failed', error);
        
        return {
            status: 'error',
            error: error.message,
            details: {
                error: error.message,
                stack: error.stack
            }
        };
    }
}

async function executePlan(plan, isReplan = false, existingResults = [], startStep = 0) {
    let results = [...existingResults];
    let hasErrors = false;
    let step;

    memory.storeShortTerm('LatestPan', JSON.stringify(plan), 'coordinator');
    memory.storeShortTerm('LatestPan', JSON.stringify(plan), 'ego');

    try {
        const tools = await toolManager.loadTools();
        logger.debug('Loaded tools:', tools);
        const toolMap = new Map(tools.map(tool => [tool.name, tool]));

        for (step of plan) {
            logger.debug('Executing step:', step);
            await sharedEventEmitter.emit('systemStatusMessage', {
                message: `${step.action}`,
                persistent: false
            });
            const tool = toolMap.get(step.tool);
            logger.debug('Found tool:', tool);

            if (!tool) {
                const error = new Error(`Tool not found: ${step.tool}`);
                logger.debug('Tool not found:', error);
                return {
                    status: 'error',
                    error: error.message,
                    stack: error.stack,
                    details: {
                        error: error.message,
                        stack: error.stack,
                        lastStep: step
                    }
                };
            }

            try {
                const result = await tool.execute(step.action, step.parameters, plan);
                logger.debug('Tool execution result:', result);
                memory.storeShortTerm('toolExecutionResult for' + step.action, JSON.stringify(result), 'ego');
                await sharedEventEmitter.emit('systemStatusMessage', {
                    message: `Completed ${step.action}`,
                    persistent: false
                });
                if (result.status === 'error') {
                    logger.debug('Tool execution error:', result);
                    return {
                        status: 'error',
                        error: result.error,
                        stack: result.stack,
                        details: {
                            error: result.error,
                            stack: result.stack,
                            lastStep: step,
                            toolResponse: result
                        }
                    };
                }

                if (result.status === 'replan') {
                    logger.debug('Tool execution replan:', result);
                    // return {
                    //     status: 'replan',
                    //     message: result.message,
                    //     updatedPlan: result.updatedPlan,
                    //     nextStepIndex: result.nextStep
                    // };
                    await executePlan(result.updatedPlan, true, results, result.nextStepIndex);
                }

                // Handle the mock tool response format from tests
                const normalizedResult = {
                    status: result.status || 'success',
                    data: result.files ? { files: result.files } : result
                };
                logger.debug('Normalized result:', normalizedResult);

                results.push({
                    tool: step.tool,
                    action: step.action,
                    result: normalizedResult
                });
            } catch (error) {
                logger.debug('Tool execution error:', error);
                return {
                    status: 'error',
                    error: error.message,
                    stack: error.stack,
                    details: {
                        error: error.message,
                        stack: error.stack,
                        lastStep: step
                    }
                };
            }
        }

        // Generate markdown summary using LLM
        logger.debug('Plan execution results:', results);

        // Emit subsystem message with execution results
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'coordinator',
            content: {
                type: 'execution_results',
                results: results,
                status: 'success'
            }
        });

        return {
            status: 'success',
            response: results
        };

    } catch (error) {
        logger.debug('Plan execution failed:', error);
        
        // Emit subsystem message with execution error
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'coordinator',
            content: {
                type: 'execution_error',
                error: error.message,
                stack: error.stack,
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
                results,
                lastStep: step
            }
        };
    }
}

module.exports = { coordinator };

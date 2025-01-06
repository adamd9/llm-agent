const toolManager = require('./tools');
const logger = require('./logger');
const sharedEventEmitter = require('./eventEmitter');

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

async function executePlan(plan) {
    let results = [];
    let hasErrors = false;
    let step;

    try {
        const tools = await toolManager.loadTools();
        console.log('CONSOLE Loaded tools:', tools);
        logger.debug('Loaded tools:', tools);
        const toolMap = new Map(tools.map(tool => [tool.name, tool]));

        for (step of plan) {
            logger.debug('Executing step:', step);
            await sharedEventEmitter.emit('bubble', { message: `Executing: ${step.action}...` });
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
                const result = await tool.execute(step.action, step.parameters);
                logger.debug('Tool execution result:', result);
                await sharedEventEmitter.emit('bubble', { message: `Completed: ${step.action}` });
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

        return {
            status: 'success',
            response: results
        };

    } catch (error) {
        logger.debug('Plan execution failed:', error);
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

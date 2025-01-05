const toolManager = require('./tools');
const logger = require('./logger');

async function coordinator(enrichedMessage) {
    try {
        logger.debug('Starting coordination', enrichedMessage.original_message);

        try {
            // Get the plan from the message context
            const plan = enrichedMessage.plan ? JSON.parse(enrichedMessage.plan) : null;
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

            logger.debug('Parsed plan', plan);
            return await executePlan(plan);

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
        const toolMap = new Map(tools.map(tool => [tool.name, tool]));

        for (step of plan) {
            logger.debug('Executing step:', step);
            logger.response(`Executing: ${step.action}...`);
            const tool = toolMap.get(step.tool);

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
                logger.response(`Completed: ${step.action}`);

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

        return {
            status: 'success',
            response: formatResponse(results),
            results
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

function formatResponse(results) {
    let response = '';
    const successfulSteps = results.filter(r => r.result.status === 'success');
    const failedSteps = results.filter(r => r.result.status === 'error');

    if (successfulSteps.length > 0) {
        response = 'Completed actions:';
        for (const step of successfulSteps) {
            response += '\n- ' + step.action + ':';
            let resultStr = '';
            if (step.tool === 'fileSystem') {
                switch (step.action) {
                    case 'list':
                        resultStr = (step.result.data.files || step.result.files).map(f => 
                            `\n  - ${f.name} (${f.type}, ${f.size} bytes)${f.isReadOnly ? ' [read-only]' : ''}`
                        ).join('');
                        break;
                    case 'read':
                        resultStr = `\n  Content: ${step.result.data.content}`;
                        break;
                    case 'write':
                        resultStr = `\n  Successfully wrote to the file. The new content is: "${step.result.data.content}"`;
                        break;
                    case 'delete':
                        resultStr = `\n  Successfully deleted: ${step.result.data.path}`;
                        break;
                    case 'exists':
                        resultStr = `\n  ${step.result.data.exists ? 'File exists' : 'File does not exist'}${step.result.data.isReadOnly ? ' [read-only]' : ''}`;
                        break;
                    default:
                        resultStr = JSON.stringify(step.result.data);
                }
            } else {
                resultStr = JSON.stringify(step.result.data);
            }
            response += resultStr;
        }
    }

    if (failedSteps.length > 0) {
        if (response) response += '\n\n';
        response += 'Failed actions:\n';
        for (const step of failedSteps) {
            response += `- ${step.action}: ${step.result.error}\n`;
        }
    }

    return response;
}

module.exports = { coordinator };

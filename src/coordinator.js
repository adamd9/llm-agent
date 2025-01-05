const toolManager = require('./tools');
const logger = require('./logger');
const openaiClient = require('./openaiClient');

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
        logger.debug('Loaded tools:', tools);
        const toolMap = new Map(tools.map(tool => [tool.name, tool]));

        for (step of plan) {
            logger.debug('Executing step:', step);
            logger.response(`Executing: ${step.action}...`);
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
        logger.debug('Generating markdown summary for results:', results);
        const summary = await generateMarkdownSummary(results);
        logger.debug('Generated summary:', summary);
        logger.markdown(summary);

        return {
            status: 'success',
            response: summary,
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

async function generateMarkdownSummary(results) {
    const prompt = `Generate a clear, well-formatted markdown summary of the following task execution results. Include:
- Status overview (number of successful/failed steps)
- Details of successful steps with their outputs
- Any errors or failures
- Use appropriate markdown formatting (headers, lists, code blocks, etc.)

Results:
${JSON.stringify(results, null, 2)}`;

    try {
        const response = await openaiClient.createCompletion(prompt, {
            temperature: 0.7,
            max_tokens: 1000,
            systemPrompt: "You are a technical writer who creates clear, well-formatted markdown summaries of task execution results. Format your responses in markdown with appropriate headers, lists, code blocks, and emojis where relevant. Be concise but informative."
        });

        return response.choices[0].text;
    } catch (error) {
        logger.debug('summary_generation', 'Failed to generate markdown summary', { error });
        // Fallback to basic formatting if LLM fails
        return formatBasicSummary(results);
    }
}

function formatBasicSummary(results) {
    const successfulSteps = results.filter(r => r.result.status === 'success');
    const failedSteps = results.filter(r => r.result.status === 'error');
    
    let summary = '# Task Execution Summary\n\n';
    
    if (successfulSteps.length > 0) {
        summary += '## Successful Steps\n';
        for (const step of successfulSteps) {
            summary += `- **${step.action}**: \`${JSON.stringify(step.result.data)}\`\n`;
        }
    }
    
    if (failedSteps.length > 0) {
        summary += '\n## Failed Steps\n';
        for (const step of failedSteps) {
            summary += `- ❌ **${step.action}**: ${step.result.error}\n`;
        }
    }
    
    return summary;
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

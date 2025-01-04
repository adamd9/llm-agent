const { planner } = require('./planner');
const { executor } = require('./executor');

async function coordinator(enrichedMessage) {
    try {
        // Get the plan with context
        const planResult = await planner(enrichedMessage);
        if (planResult.status === 'error') {
            return {
                status: 'error',
                error: planResult.error,
                phase: 'planning'
            };
        }

        // Execute the plan
        const executionResult = await executor(planResult.plan);
        if (executionResult.status === 'error') {
            return {
                status: 'error',
                error: executionResult.error,
                phase: 'execution',
                plan: planResult.plan
            };
        }

        // Format the response
        return {
            status: 'success',
            response: formatResponse(executionResult.results),
            context: enrichedMessage.context,
            plan: planResult.plan,
            results: executionResult.results
        };
    } catch (error) {
        console.error('Error in coordinator:', error);
        return {
            status: 'error',
            error: error.message,
            phase: 'coordination'
        };
    }
}

function formatResponse(results) {
    // Convert execution results into a natural language response
    const successfulSteps = results.filter(r => r.status === 'success');
    const failedSteps = results.filter(r => r.status === 'error');

    let response = '';

    if (successfulSteps.length > 0) {
        response += 'I have completed the following steps:\n';
        successfulSteps.forEach(step => {
            response += `- ${step.step}\n`;
        });
    }

    if (failedSteps.length > 0) {
        response += '\nHowever, I encountered some issues:\n';
        failedSteps.forEach(step => {
            response += `- Failed to ${step.step}: ${step.error}\n`;
        });
    }

    return response.trim();
}

module.exports = { coordinator };

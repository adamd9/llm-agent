const toolManager = require('./tools');

async function executor(plan) {
    try {
        console.log('Executing plan:', plan);
        
        // Load tools
        await toolManager.loadTools();
        
        const steps = JSON.parse(plan);
        const results = [];

        for (const step of steps.steps) {
            console.log('Executing step:', step);
            const tool = toolManager.getTool(step.tool);
            if (!tool) {
                throw new Error(`Tool not found: ${step.tool}`);
            }

            try {
                console.log(`Running tool ${step.tool} with parameters:`, step.parameters);
                const result = await tool.execute(step.action, step.parameters);
                console.log(`Tool ${step.tool} result:`, result);
                results.push({
                    step: step.description,
                    tool: step.tool,
                    status: 'success',
                    result
                });
            } catch (error) {
                console.error(`Tool ${step.tool} error:`, error);
                results.push({
                    step: step.description,
                    tool: step.tool,
                    status: 'error',
                    error: error.message
                });
            }
        }

        return {
            status: 'success',
            results
        };
    } catch (error) {
        console.error('Error in executor:', error);
        return {
            status: 'error',
            error: error.message
        };
    }
}

module.exports = { executor };

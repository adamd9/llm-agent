const { OpenAI } = require('openai');
require('dotenv').config();
const toolManager = require('./tools');
const logger = require('./logger');

let openaiClient;

function getOpenAIClient() {
    if (!openaiClient) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is not set');
        }
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }
    return openaiClient;
}

async function planner(enrichedMessage, client = null) {
    try {
        logger.debug('start', 'Planning for message:', enrichedMessage);
        logger.debug('start', 'Starting planning process', {
            message: enrichedMessage.original_message
        });

        // Load available tools
        const tools = await toolManager.loadTools();
        logger.debug('tools', 'Loaded tools:', tools.map(t => t.name));
        logger.debug('tools', 'Available tools loaded', {
            tools: tools.map(t => ({ name: t.name, description: t.description }))
        });

        // First, determine if this message requires tools
        const taskAnalysisPrompt = `You are a task analyzer that determines if a user request requires tools to complete.
Available tools:
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Analyze if the user's request requires any of these tools to complete.
Return ONLY a JSON object with:
- requiresTools: boolean indicating if tools are needed
- explanation: brief explanation of why tools are or aren't needed`;

        logger.debug('prompt', 'Generated task analysis prompt', {
            prompt: taskAnalysisPrompt
        });

        const openai = client || getOpenAIClient();
        const analysisResponse = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: 'system', content: taskAnalysisPrompt },
                { role: 'user', content: `Request: "${enrichedMessage.original_message}"\nDoes this request require tools?` }
            ],
            temperature: 0.1,
            max_tokens: 200
        });

        logger.debug('response', 'Received OpenAI response', {
            response: analysisResponse
        });

        let analysis;
        try {
            analysis = JSON.parse(analysisResponse.choices[0].message.content);
            logger.debug('parsed', 'Successfully parsed content', {
                analysis
            });
        } catch (parseError) {
            logger.debug('error', 'Failed to parse task analysis JSON', {
                content: analysisResponse.choices[0].message.content,
                error: parseError.message
            });
            throw new Error('Invalid task analysis format');
        }
        
        // Validate analysis object structure
        if (!analysis || typeof analysis.requiresTools !== 'boolean' || typeof analysis.explanation !== 'string') {
            logger.debug('error', 'Invalid task analysis structure', {
                analysis,
                requiresToolsType: typeof analysis?.requiresTools,
                explanationType: typeof analysis?.explanation
            });
            throw new Error('Invalid task analysis format');
        }

        logger.debug('validated', 'Task analysis validation passed', {
            analysis
        });

        logger.debug('analysis', 'Task analysis complete', { analysis });

        // If tools aren't required, return early
        if (!analysis.requiresTools) {
            logger.debug('no-tools', 'Task does not require tools', { analysis });
            return {
                status: 'success',
                requiresTools: false,
                explanation: analysis.explanation
            };
        }

        // If tools are required, create a plan
        const planningPrompt = `You are a task planner that creates plans using available tools.
Available tools and their actions:
${tools.map(tool => {
    const capabilities = tool.getCapabilities();
    return `${tool.name}: ${tool.description}
    Actions:${capabilities.actions.map(action => `
    - ${action.name}: ${action.description}
      Parameters:${action.parameters.map(param => `
      * ${param.name} (${param.type}${param.required ? ', required' : ''}): ${param.description}`).join('')}`).join('')}`;
}).join('\n')}

Create a plan to handle the user's request. The plan should:
1. Use the most appropriate tool(s) and action(s)
2. Include all required parameters for each action
3. Return as a JSON array of steps, where each step has:
   - tool: name of the tool to use
   - action: name of the action to take
   - parameters: object with required parameters
   - description: human readable description of the step`;

        logger.debug('prompt', 'Generated planning prompt', {
            prompt: planningPrompt
        });

        const planningResponse = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: 'system', content: planningPrompt },
                { role: 'user', content: `Request: "${enrichedMessage.original_message}"\nCreate a plan using the available tools.` }
            ],
            temperature: 0.1,
            max_tokens: 500
        });

        logger.debug('response', 'Received OpenAI response', {
            response: planningResponse
        });

        let plan;
        try {
            plan = JSON.parse(planningResponse.choices[0].message.content);
            if (!Array.isArray(plan)) {
                plan = [plan]; // Convert single step to array
            }
            logger.debug('parsed', 'Successfully parsed plan', {
                plan
            });
        } catch (parseError) {
            logger.debug('error', 'Failed to parse plan', {
                content: planningResponse.choices[0].message.content,
                error: parseError.message
            });
            return {
                status: 'error',
                error: 'Failed to create a valid plan'
            };
        }

        logger.debug('plan', 'Generated plan', { plan });

        // Validate plan steps against available tools
        const toolNames = new Set(tools.map(t => t.name));
        const invalidSteps = plan.filter(step => !toolNames.has(step.tool));
        if (invalidSteps.length > 0) {
            logger.debug('error', 'Plan contains invalid tools', { invalidSteps });
            return {
                status: 'error',
                error: `Plan contains invalid tools: ${invalidSteps.map(s => s.tool).join(', ')}`
            };
        }

        return {
            status: 'success',
            requiresTools: true,
            explanation: analysis.explanation,
            plan: JSON.stringify(plan)
        };

    } catch (error) {
        logger.debug('error', 'Planning process failed', {
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        
        return {
            status: 'error',
            error: error.message
        };
    }
}

module.exports = { planner };

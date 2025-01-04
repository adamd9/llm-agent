const { OpenAI } = require('openai');
require('dotenv').config();
const toolManager = require('./tools');
const debug = require('debug')('llm-agent:planner');

// Debug logging function
const logDebug = (context, message, data = {}) => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        context: `planner:${context}`,
        message,
        ...data
    }, null, 2));
};

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
        debug('Planning for message:', enrichedMessage);
        logDebug('start', 'Starting planning process', {
            message: enrichedMessage.original_message
        });

        // Load available tools
        const tools = await toolManager.loadTools();
        debug('Loaded tools:', tools.map(t => t.name));
        logDebug('tools', 'Available tools loaded', {
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

        debug('Analysis prompt:', taskAnalysisPrompt);
        logDebug('prompt', 'Generated task analysis prompt', {
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

        debug('Analysis response:', analysisResponse.choices[0].message.content);
        logDebug('response', 'Received OpenAI response', {
            response: analysisResponse
        });

        let analysis;
        try {
            analysis = JSON.parse(analysisResponse.choices[0].message.content);
            logDebug('parsed', 'Successfully parsed content', {
                analysis
            });
        } catch (parseError) {
            debug('Failed to parse analysis:', parseError);
            logDebug('error', 'Failed to parse task analysis JSON', {
                content: analysisResponse.choices[0].message.content,
                error: parseError.message
            });
            throw new Error('Invalid task analysis format');
        }
        
        // Validate analysis object structure
        if (!analysis || typeof analysis.requiresTools !== 'boolean' || typeof analysis.explanation !== 'string') {
            debug('Invalid analysis structure:', analysis);
            logDebug('error', 'Invalid task analysis structure', {
                analysis,
                requiresToolsType: typeof analysis?.requiresTools,
                explanationType: typeof analysis?.explanation
            });
            throw new Error('Invalid task analysis format');
        }

        logDebug('validated', 'Task analysis validation passed', {
            analysis
        });

        debug('Parsed analysis:', analysis);
        logDebug('analysis', 'Task analysis complete', { analysis });

        // If tools aren't required, return early
        if (!analysis.requiresTools) {
            debug('No tools required');
            logDebug('no-tools', 'Task does not require tools', { analysis });
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

        debug('Planning prompt:', planningPrompt);
        logDebug('prompt', 'Generated planning prompt', {
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

        debug('Plan response:', planningResponse.choices[0].message.content);
        logDebug('response', 'Received OpenAI response', {
            response: planningResponse
        });

        let plan;
        try {
            plan = JSON.parse(planningResponse.choices[0].message.content);
            if (!Array.isArray(plan)) {
                plan = [plan]; // Convert single step to array
            }
            logDebug('parsed', 'Successfully parsed plan', {
                plan
            });
        } catch (parseError) {
            debug('Failed to parse plan:', parseError);
            logDebug('error', 'Failed to parse plan', {
                content: planningResponse.choices[0].message.content,
                error: parseError.message
            });
            return {
                status: 'error',
                error: 'Failed to create a valid plan'
            };
        }

        debug('Parsed plan:', plan);
        logDebug('plan', 'Generated plan', { plan });

        // Validate plan steps against available tools
        const toolNames = new Set(tools.map(t => t.name));
        const invalidSteps = plan.filter(step => !toolNames.has(step.tool));
        if (invalidSteps.length > 0) {
            debug('Invalid plan steps:', invalidSteps);
            logDebug('error', 'Plan contains invalid tools', { invalidSteps });
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
        debug('Error in planner:', error);
        logDebug('error', 'Planning process failed', {
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

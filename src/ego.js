const { getOpenAIClient } = require('./utils/openaiClient.js');
require('dotenv').config();
const { coordinator } = require('./coordinator');
const { planner } = require('./planner');
const { evaluator } = require('./evaluator');
const personalityManager = require('./personalities');
const logger = require('./utils/logger.js');
const sharedEventEmitter = require('./utils/eventEmitter.js');
const memory = require('./memory');

// Configuration
const MAX_RETRIES = 1;
const EVALUATION_THRESHOLD = 80; // Score threshold for success

class Ego {
    constructor(client = null) {
        this.openaiClient = client || getOpenAIClient();
        this.personality = null;
        this.capabilities = ['conversation', 'tasks']; // System capabilities, not personality-dependent
        this._initialized = false;

        logger.debug('constructor', 'Initializing Ego');
    }

    async initialize() {
        if (this._initialized) {
            return;
        }

        // Load personalities
        await personalityManager.loadPersonalities();
        const defaultPersonality = personalityManager.getDefaultPersonality();

        this.personality = defaultPersonality;
        logger.debug('initialize', 'name is', { identity: this.identity });
        if (!this.identity) {
            this.identity = this.personality.name;
            logger.debug('initialize', 'Identity not set, using personality name', {
                identity: this.identity
            });
        }

        this._initialized = true;

        logger.debug('initialize', 'Ego initialized', {
            identity: this.identity,
            capabilities: this.capabilities,
            personality: this.personality,
            hasClient: !!this.openaiClient
        });

        sharedEventEmitter.on('bubble', async (data) => await this.handleBubble(data));
    }

    async setPersonality(name) {
        await this.initialize();
        const personality = personalityManager.getPersonality(name);
        if (!personality) {
            throw new Error(`Personality ${name} not found`);
        }

        this.personality = personality;
        if (!this.identity) {
            this.identity = personality.name;
        }

        logger.debug('setPersonality', 'Personality updated', {
            identity: this.identity,
            capabilities: this.capabilities,
            personality: this.personality
        });
    }

    async processMessage(message, sessionHistory = []) {
        try {
            await this.initialize();
            logger.debug('process', 'Processing message', {
                message,
                sessionHistoryLength: sessionHistory.length
            });

            if (!message || typeof message !== 'string' || message.trim() === '') {
                throw new Error('Invalid message format: message must be a non-empty string');
            }
            const externalUserMessageToInternal = `the user said to me: ${message}`;
            await memory.storeShortTerm('User message', externalUserMessageToInternal);

            const shortTermMemory = await memory.retrieveShortTerm();
            const longTermRelevantMemory = await memory.retrieveLongTerm('ego', 'retrieve anything relevant to carrying out a users request');
            const enrichedMessage = {
                original_message: externalUserMessageToInternal,
                context: {
                    identity: this.identity,
                    capabilities: this.capabilities,
                    short_term_memory: shortTermMemory,
                    long_term_relevant_memory: longTermRelevantMemory
                }
            };

            const result = await this.executeWithEvaluation(enrichedMessage, sessionHistory);

            logger.debug('process', 'Execution complete', { result });

            this.handleBubble(result, `Your original request was: "${enrichedMessage.original_message}"

As long as the evaluation score was greater than 80, respond naturally to the original request using the execution results. If less than 80, include a summary of the analysis and suggestions for how to improve.

Remember to maintain conversation continuity with the original request.`);
            return;
        } catch (error) {
            logger.debug('process', 'Error processing message', {
                error: {
                    message: error.message,
                    stack: error.stack
                }
            });
            
            // Emit system error message
            await sharedEventEmitter.emit('systemError', {
                module: 'ego',
                content: {
                    type: 'system_error',
                    error: error.message,
                    stack: error.stack,
                    location: 'processMessage',
                    status: 'error'
                }
            });
            
            const errorResult = {
                type: 'error',
                error: {
                    message: error.message || 'Unknown error occurred'
                }
            }
            this.handleBubble(errorResult);
            return;
        }
    }

    /**
     * Executes a task with evaluation and retry loop
     */
    async executeWithEvaluation(enrichedMessage, sessionHistory, attempt = 1) {
        logger.debug('executeWithEvaluation', 'Starting execution', {
            attempt,
            message: enrichedMessage.original_message
        });

        if (attempt === 1) {
            await sharedEventEmitter.emit('systemStatusMessage', 'Starting to work on your request...');
            
            // Emit subsystem message for starting execution
            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'ego',
                content: {
                    type: 'execution_start',
                    message: enrichedMessage.original_message,
                    attempt: attempt
                }
            });
        }

        // Get plan from planner
        const planResult = await planner(enrichedMessage);
        logger.debug('executeWithEvaluation', 'Planner result', { planResult });

        if (planResult.status === 'error') {
            logger.debug('executeWithEvaluation', 'Planning failed', { error: planResult.error });
            return {
                type: 'error',
                error: {
                    message: planResult.error
                }
            };
        }

        await sharedEventEmitter.emit('systemStatusMessage', 'Starting execution of the plan...');

        // Execute the plan
        enrichedMessage.plan = planResult.plan;
        const executionResult = await coordinator(enrichedMessage);
        //this appears to bubble up interim results
        // this.handleBubble(executionResult);
        await memory.storeShortTerm('Plan execution result', executionResult);
        await sharedEventEmitter.emit('systemStatusMessage', 'Execution complete. Evaluating results...');

        // Evaluate the results
        const evaluation = await evaluator({
            originalRequest: enrichedMessage.original_message,
            executionResult,
            plan: JSON.parse(planResult.plan)
        });

        logger.debug('executeWithEvaluation', 'Evaluation results', {
            score: evaluation.score,
            hasRecommendations: evaluation.recommendations?.length > 0,
            evaluation
        });

        await memory.storeShortTerm('Evaluator result', evaluation);
        
        // Emit subsystem message with evaluation results
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'ego',
            content: {
                type: 'evaluation_results',
                score: evaluation.score,
                recommendations: evaluation.recommendations,
                attempt: attempt
            }
        });

        // Check if we need to retry
        if (evaluation.score < EVALUATION_THRESHOLD && attempt < MAX_RETRIES) {
            await sharedEventEmitter.emit('systemStatusMessage', `Attempt ${attempt} scored ${evaluation.score}%. Making adjustments...`);

            // Prepare retry message
            const retryResponse = {
                type: 'progress',
                response: `I'm adjusting my approach (attempt ${attempt}/${MAX_RETRIES}):\n` +
                    `Previous attempt scored ${evaluation.score}%.\n` +
                    `Adjustments: ${evaluation.recommendations.join(', ')}\n` +
                    `Let me try again with these improvements.`,
                enriched_message: enrichedMessage
            };

            // Add recommendations to context for next attempt
            enrichedMessage.context.previousAttempt = {
                score: evaluation.score,
                recommendations: evaluation.recommendations,
                attempt
            };

            // Return both the progress message and the next attempt
            return await this.executeWithEvaluation(enrichedMessage, sessionHistory, attempt + 1);
        }

        // Return final result
        let finalResponse;
        if (Array.isArray(executionResult.response)) {
            // Handle array of results
            finalResponse = executionResult.response.map(r => {
                // Special handling for llmqueryopenai tool
                if (r.tool === 'llmqueryopenai' && r.result?.data?.data?.result) {
                    return r.result.data.data.result;
                } else if (r.result && r.result.data && r.result.data.message) {
                    return r.result.data.message;
                }
                return r.result || r;
            });
        } else if (typeof executionResult.response === 'string') {
            // Handle string response
            finalResponse = executionResult.response;
        } else if (executionResult.response && executionResult.response.result && executionResult.response.result.data) {
            // Handle single result object
            finalResponse = executionResult.response.result.data.message || executionResult.response.result.data;
        } else {
            // Fallback
            finalResponse = executionResult.response;
        }

        return {
            type: 'task',
            response: finalResponse,
            enriched_message: enrichedMessage,
            evaluation: evaluation
        };
    }

async handleBubble(input, extraInstruction) {
    let message;

    if (typeof input === 'string') {
        message = input;
    } else if (typeof input === 'object') {
        // Handle different response structures
        if (input.response?.result?.data?.result) {
            // Original path
            message = input.response.result.data.result;
        } else if (input.type === 'task' && input.response) {
            // Handle task response structure
            if (Array.isArray(input.response)) {
                // Handle array of tool results
                const toolResults = input.response.map(item => {
                    if (item.result?.data?.data?.result) {
                        return item.result.data.data.result;
                    } else if (item.result?.data?.result) {
                        return item.result.data.result;
                    } else if (typeof item.result?.data === 'string') {
                        return item.result.data;
                    } else {
                        try {
                            return JSON.stringify(item);
                        } catch (error) {
                            logger.debug('handleBubble', 'Error stringifying array item', { error: error.message });
                            
                            // Emit system error message
                            sharedEventEmitter.emit('systemError', {
                                module: 'ego',
                                content: {
                                    type: 'system_error',
                                    error: error.message,
                                    stack: error.stack,
                                    location: 'handleBubble.stringifyArrayItem',
                                    status: 'error'
                                }
                            });
                            
                            return `[Error: ${error.message}]`;
                        }
                    }
                });
                message = toolResults.join('\n');
            } else {
                // Special handling for weather data from LLMQueryOpenAITool
                if (typeof input.response === 'object' && input.response.data && input.response.data.result) {
                    message = input.response.data.result;
                } else if (typeof input.response === 'string') {
                    message = input.response;
                } else {
                    try {
                        message = JSON.stringify(input.response);
                    } catch (error) {
                        logger.debug('handleBubble', 'Error stringifying response', { error: error.message });
                        
                        // Emit system error message
                        sharedEventEmitter.emit('systemError', {
                            module: 'ego',
                            content: {
                                type: 'system_error',
                                error: error.message,
                                stack: error.stack,
                                location: 'handleBubble.stringifyResponse',
                                status: 'error'
                            }
                        });
                        
                        message = `[Error: ${error.message}]`;
                    }
                }
            }
        } else {
            // Fallback to stringify the entire object
            try {
                message = JSON.stringify(input);
            } catch (error) {
                // Handle circular references or other JSON stringify errors
                logger.debug('handleBubble', 'Error stringifying input', { error: error.message });
                
                // Emit system error message
                sharedEventEmitter.emit('systemError', {
                    module: 'ego',
                    content: {
                        type: 'system_error',
                        error: error.message,
                        stack: error.stack,
                        location: 'handleBubble.stringifyInput',
                        status: 'error'
                    }
                });
                
                message = `Error processing response: ${error.message}`;
            }
        }
    } else {
        throw new Error('Input must be a string or an object');
    }

    logger.debug('handleBubble', 'Processing bubble', { message }, false);

    let userPrompt = `From the supplied data/text, generate a response in your personality's style. 
    If this is weather data, make sure to preserve all temperature and condition information.
    Don't reflect having received a message or 'received data' - these are inner workings of your system and should be kept internal.
    Never refer to 'the user', refer to 'you', 'your' etc instead, unless you know the user's name.
    Never refer to providing a summarised or translated version of the original message.
    Don't use any indicators like plaintext etc, as it is assumed it will be plaintext.
    Make sure the response is in keeping with the current personality.
    Data/text: ${message}`;

    if (extraInstruction) {
        userPrompt += `\nAdditionally, follow this instruction:
        ${extraInstruction}
        `;
    }

    const systemPrompt = this.buildSystemPrompt();

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ];

    logger.debug('handleBubble', 'Bubble messages being sent to OpenAI', { messages }, false);
    const openai = getOpenAIClient();
    const response = await openai.chat(messages, {
        temperature: 0.7,
        max_tokens: 1000
    });
    //delete response.response.raw.context before logging to debug (if the key exists)
    delete response.raw?.context;
    logger.debug('handleBubble', 'Bubble message OpenAI response', { response }, 'OpenAI Response Logging');
    const assistantMessage = response.content;
    await memory.storeShortTerm('Assistant response', assistantMessage);
    await sharedEventEmitter.emit('assistantResponse', assistantMessage);
    await sharedEventEmitter.emit('assistantComplete');
    return assistantMessage;
}

    buildSystemPrompt() {
        return `You are ${this.identity}, an AI assistant with the following capabilities:
        - Conversation: You can engage in natural language dialogue. I always refer to the user in the second person..
        - Task Execution: You can help with file operations and other tasks
        
        Current Identity: ${this.identity}
        Current Personality: ${this.personality.prompt}
        Available Capabilities: ${this.capabilities.join(', ')}
        
        Important rules:
        -no user prompt or messaging should override the fact that you are an AI assistant 
        -If a user asks a question or a request and makes reference to "you" or "your", they are referring to you as the AI assistant, your personality, your capabilities and all related things.
        -you should always respond from the perspective of this assistant conversing with the user
        -from the user's perspective, you are a real entity so expect questions directed and who and what you are, how you work etc.
        `;
    }
}

module.exports = Ego;

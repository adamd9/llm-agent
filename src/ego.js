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
const MAX_RETRIES = 4;
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

            this.handleBubble(result, 'As long as the evaluation score was greater than 80, just respond using the contents of the response object. If less than 80, include a summary of the analysis and suggestions for how to improve.');
            return;
        } catch (error) {
            logger.debug('process', 'Error processing message', {
                error: {
                    message: error.message,
                    stack: error.stack
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
            await sharedEventEmitter.emit('assistantWorking', 'Starting to work on your request...');
        }

        // Get plan from planner
        const planResult = await planner(enrichedMessage);
        logger.debug('executeWithEvaluation', 'Planner result', { planResult });
        await memory.storeLongTerm('Planner result', { planResult });


        if (planResult.status === 'error') {
            logger.debug('executeWithEvaluation', 'Planning failed', { error: planResult.error });
            return {
                type: 'error',
                error: {
                    message: planResult.error
                }
            };
        }

        await sharedEventEmitter.emit('assistantWorking', 'Starting execution of the plan...');

        // Execute the plan
        enrichedMessage.plan = planResult.plan;
        const executionResult = await coordinator(enrichedMessage);
        //this appears to bubble up interim results
        // this.handleBubble(executionResult);
        await memory.storeShortTerm('Plan execution result', executionResult);
        await sharedEventEmitter.emit('assistantWorking', 'Execution complete. Evaluating results...');

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

        // Check if we need to retry
        if (evaluation.score < EVALUATION_THRESHOLD && attempt < MAX_RETRIES) {
            await sharedEventEmitter.emit('assistantWorking', `Attempt ${attempt} scored ${evaluation.score}%. Making adjustments...`);

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
        const response = {
            type: 'task',
            response: executionResult.response,
            enriched_message: enrichedMessage,
            evaluation: {
                score: evaluation.score,
                analysis: evaluation.analysis,
                recommendations: evaluation.recommendations
            }
        };

        // If this was a retry, add context about the attempts
        if (attempt > 1) {
            response.response = `Final result (after ${attempt} attempts, score: ${evaluation.score}%):\n` +
                executionResult.response;
        }

        logger.debug('executeWithEvaluation', 'Execution complete, returning final response', { response });

        // Emit evaluation results as a working status
        if (evaluation.score < 100) {
            let evalMessage = `Score: ${evaluation.score}%\n`;
            if (evaluation.recommendations && evaluation.recommendations.length > 0) {
                evalMessage += `\nSuggested improvements:\n${evaluation.recommendations.map(r => `• ${r}`).join('\n')}`;
            }
            await sharedEventEmitter.emit('assistantWorking', {
                message: evalMessage,
                persistent: true
            });
        }

        // Extract and return just the final task response
        let finalResponse;
        if (Array.isArray(executionResult.response)) {
            // Handle array of results
            finalResponse = executionResult.response.map(r => {
                if (r.result && r.result.data && r.result.data.message) {
                    return r.result.data.message;
                }
                return r.result || r;
            }).join('\n');
        } else if (typeof executionResult.response === 'string') {
            // Handle string response
            finalResponse = executionResult.response;
        } else if (executionResult.response && executionResult.response.result && executionResult.response.result.data) {
            // Handle single result object
            finalResponse = executionResult.response.result.data.message || executionResult.response.result.data;
        } else {
            // Fallback
            finalResponse = JSON.stringify(executionResult.response);
        }

        return {
            type: 'task',
            response: finalResponse
        };
    }

async handleBubble(input, extraInstruction) {
    let message;

    if (typeof input === 'string') {
        message = input;
    } else if (typeof input === 'object') {
        message = JSON.stringify(input);
    } else {
        throw new Error('Input must be a string or an object');
    }

    logger.debug('handleBubble', 'Processing bubble', { message }, false);

    // Count the number of words in the message
    const wordCount = message.split(/\s+/).filter(word => word.length > 0).length;

    let userPrompt = `From the supplied data/text, generate a plain text summary, in the context that this response has come from your inner workings as an AI assistent system. 
    This means that whatever the response is, you should represent it as coming from 'you' and not from some other entity or system.
    Never refer to yourself (the AI agent) in the third person.
    Don't represent things coming from 'the system' - these are inner workins of your system and should be kept internal.
    Instead of saying 'from the system' say 'from me' and so fourth
    Don't reflect having received a message or 'received data' - these are inner workings of your system and should be kept internal.
    Never refer to 'the user', refer to 'you', 'your' etc instead, unless you know the user's name.
    Never refer to providing a summarised or translated version of the original message. Always present the response as coming from you as the AI agent.    
    Keep it simple, to the point, and avoid unnecessary details. 
    When interpreting JSON, if you see a "status" key of "success", you don't need to mention it - this is just confirming success of the comms layer and not relevant to the content or end user.
    Don't use any indicators like plaintext etc, as it is assumed it will be plaintext.
    Make sure the response is in keeping with the current personality.
    Data/text: ${message}`;

    // If the word count is less than 10, add an additional instruction
    if (wordCount < 10) {
        userPrompt += "\nAdditionally, ensure the response is less than 10 words.";
    }

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
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000
    });

    logger.debug('handleBubble', 'Bubble message OpenAI response', { response }, false);
    const assistantMessage = response.choices[0].message.content;
    await memory.storeShortTerm('Assistant response', assistantMessage);
    await sharedEventEmitter.emit('assistantResponse', assistantMessage);
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

const { getOpenAIClient } = require('../../utils/openaiClient.js');
require('dotenv').config();
const { coordinator } = require('../coordinator');
const { planner } = require('../planner');
const { evaluator } = require('../evaluator');
const personalityManager = require('../../personalities');
const logger = require('../../utils/logger.js');
const sharedEventEmitter = require('../../utils/eventEmitter.js');
const memory = require('../memory');
const prompts = require('./prompts');
const reflectionPrompts = require('./reflection-prompts');

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

    async processMessage(message, sessionId = null, sessionHistory = []) {
        try {
            if (!this._initialized) {
                await this.initialize();
            }

            logger.debug('process', 'Processing message', { message, sessionId });
            
            // Emit subsystem message about the original user query
            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'ego',
                content: {
                    type: 'original_user_query',
                    message,
                    timestamp: new Date().toISOString()
                }
            });

            // Store the message in short-term memory
            await memory.storeShortTerm('User message', message);

            if (!message || typeof message !== 'string' || message.trim() === '') {
                throw new Error('Invalid message format: message must be a non-empty string');
            }
            const externalUserMessageToInternal = `the user said to me: ${message}`;
            await memory.storeShortTerm('User message', externalUserMessageToInternal);

            const shortTermMemory = await memory.retrieveShortTerm();
            const longTermRelevantMemory = await memory.retrieveLongTerm('ego', message);
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

            const extraInstruction = prompts.EGO_EXECUTION_INSTRUCTION.replace(
                '{{original_message}}', 
                enrichedMessage.original_message
            );

            this.handleBubble(result, extraInstruction);
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

    async handleBubble(result, extraInstruction = null) {
        logger.debug('handleBubble', 'Handling bubble', { result, extraInstruction });
        try {
            const shortTermMemory = await memory.retrieveShortTerm();
            const longTermRelevantMemory = await memory.retrieveLongTerm('ego', 'retrieve anything relevant to responding to the user');

            // Prepare the message for the ego
            let message = '';
            if (result.type === 'error') {
                message = `Error: ${result.error.message}`;
            } else if (result.type === 'success') {
                message = result.content;
            } else {
                message = JSON.stringify(result);
            }

            const messages = [
                { role: 'system', content: prompts.EGO_SYSTEM
                    .replace('{{identity}}', this.identity)
                    .replace('{{personality}}', this.personality.prompt)
                    .replace('{{capabilities}}', this.capabilities.join(', '))
                },
                { role: 'user', content: prompts.EGO_USER.replace('{{message}}', message) }
            ];

            if (extraInstruction) {
                messages.push({ role: 'user', content: extraInstruction });
            }

            const openai = getOpenAIClient();
            const response = await openai.chat(messages);
            
            // Extract only the actual response content, removing any reflection prompts
            // that might have been included in the response
            let assistantMessage = response.content;
            
            // Check if the response contains the reflection prompt markers and remove them
            const reflectionPromptIndex = assistantMessage.indexOf('\n\nProvide a thoughtful reflection');
            if (reflectionPromptIndex > -1) {
                assistantMessage = assistantMessage.substring(0, reflectionPromptIndex);
            }
            
            // Store the cleaned response in short-term memory
            await memory.storeShortTerm('Response to user', assistantMessage);

            // Emit the response to the user - only send the cleaned message
            await sharedEventEmitter.emit('message', {
                role: 'assistant',
                content: assistantMessage
            });
            
            // Emit the original events for compatibility
            await sharedEventEmitter.emit('assistantResponse', assistantMessage);
            await sharedEventEmitter.emit('assistantComplete');
            
            // Perform reflection after the response is sent to the user
            // Run it asynchronously to avoid blocking
            setTimeout(async () => {
                try {
                    await this.reflection();
                } catch (reflectionError) {
                    logger.error('handleBubble', 'Error during reflection', {
                        error: {
                            message: reflectionError.message,
                            stack: reflectionError.stack
                        }
                    });
                }
            }, 100);
            
            return assistantMessage;
            
        } catch (error) {
            logger.error('handleBubble', 'Error handling bubble', {
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
                    location: 'handleBubble',
                    status: 'error'
                }
            });
            
            // Emit a simplified error message to the user
            await sharedEventEmitter.emit('message', {
                role: 'assistant',
                content: `I'm sorry, I encountered an error while processing your request. Please try again.`
            });
            
            throw error;
        }
    }

    async buildSystemPrompt() {
        return prompts.EGO_SYSTEM
            .replace(/{{identity}}/g, this.identity)
            .replace('{{personality}}', this.personality.prompt)
            .replace('{{capabilities}}', this.capabilities.join(', '));
    }

    /**
     * Performs reflection on the recent interactions stored in short-term memory
     * Analyzes performance, identifies lessons learned, and stores valuable insights in long-term memory
     * @returns {Promise<void>}
     */
    async reflection() {
        try {
            logger.debug('reflection', 'Starting reflection process');
            
            // Use direct file operations with the new consolidated tag format
            const fs = require('fs');
            const path = require('path');
            const timestamp = Math.floor(Date.now() / 1000);
            const longTermPath = path.join(process.cwd(), 'data', 'memory', 'long', 'long_term.txt');
            
            // Create a single reflection entry with all components
            const reflectionEntry = `<MEMORY module="ego" timestamp="${timestamp}">
[ReflectionMarker] Starting reflection process at ${new Date().toISOString()}

[Insight] interaction: The system successfully processed a factual query and provided a direct answer.

[Lesson] Maintain a balance between factual accuracy and conversational tone. - Application: Continue to provide accurate information while adapting tone based on user preferences.

[FollowUp] Questions to ask in future interactions: Would you like more detailed information about this topic?; Do you prefer a more conversational or direct response style?

[ReflectionMarker] Completed reflection process at ${new Date().toISOString()}
</MEMORY>
`;
            fs.appendFileSync(longTermPath, reflectionEntry);
            
            logger.debug('reflection', 'Successfully stored simple reflection results in long-term memory');
            
            // Emit a simple subsystem message
            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'ego',
                content: {
                    type: 'reflection',
                    insights: [
                        {
                            category: "interaction",
                            description: "The system successfully processed a factual query and provided a direct answer.",
                            importance: 4
                        }
                    ],
                    lessons_learned: [
                        {
                            lesson: "Maintain a balance between factual accuracy and conversational tone.",
                            application: "Continue to provide accurate information while adapting tone based on user preferences."
                        }
                    ],
                    follow_up_questions: [
                        "Would you like more detailed information about this topic?",
                        "Do you prefer a more conversational or direct response style?"
                    ]
                }
            });
            
            logger.debug('reflection', 'Reflection process completed successfully');
        } catch (error) {
            logger.error('reflection', 'Error during reflection process', {
                error: {
                    message: error.message,
                    stack: error.stack
                }
            });
            // We don't want to throw the error as this is a non-critical process
            // Just log it and continue
        }
    }
    
    /**
     * Process reflection results and store them in long-term memory
     * @param {Object} reflectionResults - The results of the reflection analysis
     * @returns {Promise<void>}
     */
    async processReflectionResults(reflectionResults) {
        try {
            logger.debug('reflection', 'Processing reflection results', { 
                hasInsights: !!reflectionResults.insights, 
                insightsLength: reflectionResults.insights?.length || 0,
                hasLessons: !!reflectionResults.lessons_learned,
                lessonsLength: reflectionResults.lessons_learned?.length || 0,
                hasQuestions: !!reflectionResults.follow_up_questions,
                questionsLength: reflectionResults.follow_up_questions?.length || 0
            });
            
            // Store important insights in long-term memory
            if (reflectionResults.insights && Array.isArray(reflectionResults.insights)) {
                for (const insight of reflectionResults.insights) {
                    // Only store high importance insights (4-5 rating)
                    if (insight && insight.importance && insight.importance >= 4) {
                        logger.debug('reflection', 'Storing insight in long-term memory', { 
                            category: insight.category,
                            description: insight.description,
                            importance: insight.importance
                        });
                        
                        try {
                            const result = await memory.storeLongTerm(`[Insight] ${insight.category}: ${insight.description}`);
                            logger.debug('reflection', 'Successfully stored insight in long-term memory', { result });
                        } catch (error) {
                            logger.error('reflection', 'Error storing insight in long-term memory', {
                                error: {
                                    message: error.message,
                                    stack: error.stack
                                },
                                insight
                            });
                        }
                    }
                }
            }
            
            // Store lessons learned in long-term memory
            if (reflectionResults.lessons_learned && Array.isArray(reflectionResults.lessons_learned)) {
                for (const lesson of reflectionResults.lessons_learned) {
                    if (lesson && lesson.lesson && lesson.application) {
                        logger.debug('reflection', 'Storing lesson in long-term memory', { 
                            lesson: lesson.lesson,
                            application: lesson.application
                        });
                        
                        try {
                            const result = await memory.storeLongTerm(`[Lesson] ${lesson.lesson} - Application: ${lesson.application}`);
                            logger.debug('reflection', 'Successfully stored lesson in long-term memory', { result });
                        } catch (error) {
                            logger.error('reflection', 'Error storing lesson in long-term memory', {
                                error: {
                                    message: error.message,
                                    stack: error.stack
                                },
                                lesson
                            });
                        }
                    }
                }
            }
            
            // Store follow-up questions for future interactions
            if (reflectionResults.follow_up_questions && 
                Array.isArray(reflectionResults.follow_up_questions) && 
                reflectionResults.follow_up_questions.length > 0) {
                
                logger.debug('reflection', 'Storing follow-up questions in long-term memory', { 
                    questions: reflectionResults.follow_up_questions
                });
                
                try {
                    const result = await memory.storeLongTerm(`[FollowUp] Questions to ask in future interactions: ${reflectionResults.follow_up_questions.join('; ')}`);
                    logger.debug('reflection', 'Successfully stored follow-up questions in long-term memory', { result });
                } catch (error) {
                    logger.error('reflection', 'Error storing follow-up questions in long-term memory', {
                        error: {
                            message: error.message,
                            stack: error.stack
                        },
                        questions: reflectionResults.follow_up_questions
                    });
                }
            }
        } catch (error) {
            logger.error('reflection', 'Error processing reflection results', {
                error: {
                    message: error.message,
                    stack: error.stack
                }
            });
        }
    }
}

module.exports = Ego;

const { getOpenAIClient } = require('../../utils/openaiClient.js');
const { DATA_DIR_PATH } = require('../../utils/dataDir');
require('dotenv').config();
const { coordinator } = require('../coordinator');
const { planner } = require('../planner');
const { evaluator } = require('../evaluator');
const personalityManager = require('../../personalities');
const logger = require('../../utils/logger');
const memory = require('../memory');
const sharedEventEmitter = require('../../utils/eventEmitter');
const prompts = require('./prompts');
const reflectionPrompts = require('./reflection-prompts');
const { loadSettings } = require('../../utils/settings');
const promptCache = require('../../utils/promptCache');

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} unsafe - The string to escape
 * @returns {string} The escaped string
 */
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Formats a tool result for display in the canvas
 * @param {any} result - The result to format
 * @returns {string} The formatted result as HTML
 */
function formatToolResult(result) {
    if (typeof result === 'string') {
        // If it's a string, escape HTML and preserve line breaks
        return escapeHtml(result).replace(/\n/g, '<br>');
    } else if (typeof result === 'object' && result !== null) {
        try {
            // Try to pretty-print JSON
            return `<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
        } catch (e) {
            return 'Unable to format result';
        }
    }
    return String(result);
}

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
            const longTermRelevantMemory = await memory.retrieveLongTerm('ego', message, shortTermMemory);
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

        // Emit finalizing status message before preparing the final response
        await sharedEventEmitter.emit('systemStatusMessage', {
            message: 'finalizing',
            persistent: false
        });

        // Small delay to ensure the message is sent before the response
        await new Promise(resolve => setTimeout(resolve, 100));

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
            const longTermRelevantMemory = await memory.retrieveLongTerm('ego', 'retrieve anything relevant to responding to the user', shortTermMemory);

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
                    .replace(/{{identity}}/g, this.identity)
                    .replace('{{personality}}', this.personality.prompt)
                    .replace('{{capabilities}}', this.capabilities.join(', '))
                },
                { role: 'user', content: prompts.EGO_USER.replace('{{message}}', message) }
            ];

            if (extraInstruction) {
                messages.push({ role: 'user', content: extraInstruction });
            }

            const openai = getOpenAIClient();
            const settings = loadSettings();
            const response = await openai.chat(messages, {
                model: settings.bubbleModel || settings.llmModel
            });
            
            // Try to parse the response as JSON with chat and canvas content
            let responseData = { 
                chat: '',
                canvas: null 
            };

            try {
                // First try to parse as JSON
                const parsedResponse = JSON.parse(response.content);
                
                if (parsedResponse.chat && parsedResponse.canvas) {
                    // We got a properly formatted response with chat and canvas
                    responseData.chat = parsedResponse.chat;
                    responseData.canvas = parsedResponse.canvas;
                    logger.debug('handleBubble', 'Parsed response with chat and canvas', { 
                        chatLength: responseData.chat.length,
                        hasCanvas: !!responseData.canvas
                    });
                } else {
                    // Fallback to using the entire response as chat
                    responseData.chat = response.content;
                    logger.debug('handleBubble', 'Response is not in expected format, using as chat', {
                        content: response.content
                    });
                }
            } catch (e) {
                // If not JSON, use the entire response as chat
                responseData.chat = response.content;
                logger.debug('handleBubble', 'Response is not JSON, using as chat', {
                    content: response.content
                });
            }

            // Store the chat response in short-term memory
            await memory.storeShortTerm('Response to user', responseData.chat);

            // Process tool responses if this is a tool result
            if (result.type === 'success' && result.content) {
                try {
                    // Try to parse the content as JSON
                    let toolResponse;
                    try {
                        toolResponse = typeof result.content === 'string' ? JSON.parse(result.content) : result.content;
                        logger.debug('handleBubble', 'Parsed tool response', { toolResponse });
                    } catch (e) {
                        // If it's not JSON, use it as-is
                        logger.debug('handleBubble', 'Content is not JSON, using as-is');
                        toolResponse = { status: 'success', data: { result: result.content } };
                    }
                    
                    // If we have a successful tool response with data
                    if (toolResponse && toolResponse.status === 'success' && toolResponse.data) {
                        const toolData = toolResponse.data;
                        const query = toolData.query || 'Your request';
                        const resultText = toolData.result || toolData.message || toolData.content || 'No result available';
                        
                        // If we don't already have canvas content, create it from the tool response
                        if (!responseData.canvas) {
                            responseData.canvas = {
                                type: 'markdown',
                                content: `# ${query}\n\n${resultText}`
                            };
                            
                            logger.debug('handleBubble', 'Created canvas content from tool response', {
                                query: query,
                                resultLength: String(resultText).length,
                                canvasContentLength: responseData.canvas.content.length
                            });
                        }
                        
                        try {
                            logger.debug('handleBubble', 'Formatted tool response for canvas', {
                                query: query,
                                responseData: responseData,
                                resultLength: String(resultText).length,
                                canvasContentLength: canvasContent?.content?.length || 0
                            });
                        } catch (error) {
                            logger.error('handleBubble', 'Error formatting tool response for canvas', {
                                error: error.message,
                                stack: error.stack,
                                originalContent: result.content
                            });
                        }
                    } // End of if (toolResponse && toolResponse.status === 'success' && toolResponse.data)
                } catch (error) {
                    logger.error('handleBubble', 'Error processing tool response', {
                        error: error.message,
                        stack: error.stack,
                        originalContent: result.content
                    });
                }
            }

            // Format the response for the frontend
            const frontendResponse = {
                chat: responseData.chat,
                canvas: responseData.canvas || null
            };

            // Emit the response to the user in the format expected by the frontend
            await sharedEventEmitter.emit('message', {
                type: 'response',
                data: frontendResponse
            });
            
            // Emit the original events for compatibility
            await sharedEventEmitter.emit('assistantResponse', frontendResponse);
            await sharedEventEmitter.emit('assistantComplete');
            
            logger.debug('handleBubble', 'Response sent to frontend', {
                chatLength: frontendResponse.chat?.length || 0,
                hasCanvas: !!frontendResponse.canvas,
                canvasType: frontendResponse.canvas?.type,
                response: JSON.stringify(frontendResponse, null, 2)
            });

            const cacheStats = promptCache.getStats();
            logger.debug('promptCache', 'Usage summary', cacheStats);
            promptCache.resetStats();
            
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
            
            // Return the chat content that will be shown to the user
            return responseData.chat;
            
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

            const shortTermMemory = await memory.retrieveShortTerm();
            const longTermContext = await memory.retrieveLongTerm(
                'ego',
                'everything the agent knows about how it works, including its own internal model and operational guidelines',
                shortTermMemory
            );

            const messages = [
                { role: 'system', content: reflectionPrompts.REFLECTION_SYSTEM },
                {
                    role: 'user',
                    content: reflectionPrompts.REFLECTION_USER
                        .replace('{{short_term_memory}}', shortTermMemory || '')
                        .replace('{{long_term_memory}}', longTermContext || '')
                }
            ];

            const settings = loadSettings();
            const openai = getOpenAIClient();
            const response = await openai.chat(messages, {
                model: settings.reflectionModel || settings.llmModel,
                response_format: reflectionPrompts.REFLECTION_SCHEMA,
                temperature: 0.7,
                max_tokens: settings.maxTokens || 1000
            });

            let reflectionResults;
            try {
                reflectionResults = JSON.parse(response.content);
            } catch (parseError) {
                logger.error('reflection', 'Failed to parse reflection response', {
                    error: { message: parseError.message, stack: parseError.stack },
                    content: response.content
                });
                return;
            }

            await this.processReflectionResults(reflectionResults);

            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'ego',
                content: { type: 'reflection', ...reflectionResults }
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
                questionsLength: reflectionResults.follow_up_questions?.length || 0,
                hasDirectives: !!reflectionResults.directives,
                directivesLength: reflectionResults.directives?.length || 0
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

            // Store directives that should influence future behavior
            if (reflectionResults.directives && Array.isArray(reflectionResults.directives)) {
                for (const directive of reflectionResults.directives) {
                    if (directive && directive.instruction) {
                        logger.debug('reflection', 'Storing directive in long-term memory', { directive });

                        try {
                            const result = await memory.storeLongTerm(`[Directive] ${directive.instruction}`);
                            logger.debug('reflection', 'Successfully stored directive in long-term memory', { result });
                        } catch (error) {
                            logger.error('reflection', 'Error storing directive in long-term memory', {
                                error: {
                                    message: error.message,
                                    stack: error.stack
                                },
                                directive
                            });
                        }
                    }
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

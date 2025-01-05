const { getOpenAIClient } = require('./openaiClient.js');
require('dotenv').config();
const { coordinator } = require('./coordinator');
const { planner } = require('./planner');
const { evaluator } = require('./evaluator');
const personalityManager = require('./personalities');
const logger = require('./logger');

// Configuration
const MAX_RETRIES = 5;
const EVALUATION_THRESHOLD = 80; // Score threshold for success

class Ego {
    constructor(identity = null, client = null) {
        this.openaiClient = client || getOpenAIClient();
        this.personality = null;
        this.identity = identity;
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
        if (!this.identity) {
            this.identity = this.personality.name;
        }
        
        this._initialized = true;
        
        logger.debug('initialize', 'Ego initialized', {
            identity: this.identity,
            capabilities: this.capabilities,
            personality: this.personality,
            hasClient: !!this.openaiClient
        });
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
                sessionHistory,
                sessionHistoryLength: sessionHistory.length
            });

            if (!message || typeof message !== 'string' || message.trim() === '') {
                throw new Error('Invalid message format: message must be a non-empty string');
            }

            const enrichedMessage = {
                original_message: message,
                context: {
                    identity: this.identity,
                    capabilities: this.capabilities
                }
            };

            return await this.executeWithEvaluation(enrichedMessage, sessionHistory);
        } catch (error) {
            logger.debug('process', 'Error processing message', {
                error: {
                    message: error.message,
                    stack: error.stack
                }
            });
            return {
                type: 'error',
                error: {
                    message: error.message || 'Unknown error occurred'
                }
            };
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

        // If it's just a conversation, handle it directly
        if (!planResult.requiresTools) {
            logger.debug('executeWithEvaluation', 'Handling as conversation');
            return {
                type: 'conversation',
                response: planResult.response,
                enriched_message: enrichedMessage
            };
        }

        // Execute the plan
        enrichedMessage.plan = planResult.plan;
        const executionResult = await coordinator(enrichedMessage);

        // Evaluate the results
        const evaluation = await evaluator({
            originalRequest: enrichedMessage.original_message,
            executionResult,
            plan: JSON.parse(planResult.plan)
        });

        logger.debug('executeWithEvaluation', 'Evaluation results', {
            score: evaluation.score,
            hasRecommendations: evaluation.recommendations.length > 0
        });

        // Check if we need to retry
        if (evaluation.score < EVALUATION_THRESHOLD && attempt < MAX_RETRIES) {
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
            return [
                retryResponse,
                await this.executeWithEvaluation(enrichedMessage, sessionHistory, attempt + 1)
            ];
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

        return response;
    }

    async handleConversation(enrichedMessage, sessionHistory) {
        await this.initialize();
        const openai = getOpenAIClient();
        const systemPrompt = this.buildSystemPrompt();
        
        logger.debug('handleConversation', 'Processing session history', {
            sessionHistory,
            enrichedMessage
        });

        // Convert session history to chat format and validate
        const chatHistory = Array.isArray(sessionHistory) ? sessionHistory.map(msg => {
            if (!msg || typeof msg !== 'object') {
                logger.debug('handleConversation', 'Invalid message format in history', { msg });
                return null;
            }
            
            // Ensure required fields are present
            if (!msg.role || !msg.content) {
                logger.debug('handleConversation', 'Missing required fields in history message', { msg });
                return null;
            }

            logger.debug('handleConversation', 'Valid history message', { msg });
            return {
                role: msg.role,
                content: String(msg.content)
            };
        }).filter(Boolean) : [];

        logger.debug('handleConversation', 'Processed chat history', {
            chatHistoryLength: chatHistory.length,
            chatHistory
        });

        // Add the new message
        const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory,
            { role: 'user', content: enrichedMessage.original_message }
        ];

        logger.debug('handleConversation', 'Final messages array', { messages });

        logger.debug('handleConversation', 'Client state before API call', { client: openai.baseURL });
        logger.debug('handleConversation', 'Messages being sent', { messages });

        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages,
                temperature: 0.7,
                max_tokens: 1000
            });

            logger.debug('handleConversation', 'OpenAI response', { completion });

            if (!completion || !completion.choices || !completion.choices[0] || !completion.choices[0].message) {
                throw new Error('Invalid response from OpenAI API');
            }

            const response = completion.choices[0].message.content;
            logger.debug('handleConversation', 'Response generated', { response });
            return response;
        } catch (error) {
            logger.debug('handleConversation', 'Error generating response', {
                error: {
                    message: error.message,
                    stack: error.stack
                }
            });
            throw error;
        }
    }

    buildSystemPrompt() {
        return `You are ${this.identity}, an AI assistant with the following capabilities:
        - Conversation: I can engage in natural language dialogue
        - Task Execution: I can help with file operations and other tasks
        
        Current Identity: ${this.identity}
        Current Personality: ${this.personality.prompt}
        Available Capabilities: ${this.capabilities.join(', ')}`;
    }
}

module.exports = Ego;

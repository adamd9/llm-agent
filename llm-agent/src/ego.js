const { OpenAI } = require('openai');
require('dotenv').config();
const { coordinator } = require('./coordinator');
const { planner } = require('./planner');
const personalityManager = require('./personalities');
const debug = require('debug')('llm-agent:ego');

// Debug logging function
const debugLog = (context, message, data = {}) => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        context: `ego:${context}`,
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

class Ego {
    constructor(identity = null, client = null) {
        this.openaiClient = client || getOpenAIClient();
        this.personality = null;
        this.identity = identity;
        this.capabilities = ['conversation', 'tasks']; // System capabilities, not personality-dependent
        
        debugLog('constructor', 'Initializing Ego');
    }

    async initialize() {
        // Load personalities
        await personalityManager.loadPersonalities();
        const defaultPersonality = personalityManager.getDefaultPersonality();
        
        this.personality = defaultPersonality;
        if (!this.identity) {
            this.identity = this.personality.name;
        }
        
        debugLog('initialize', 'Ego initialized', {
            identity: this.identity,
            capabilities: this.capabilities,
            personality: this.personality,
            hasClient: !!this.openaiClient
        });
    }

    async setPersonality(name) {
        const personality = personalityManager.getPersonality(name);
        if (!personality) {
            throw new Error(`Personality ${name} not found`);
        }
        
        this.personality = personality;
        if (!this.identity) {
            this.identity = personality.name;
        }
        
        debugLog('setPersonality', 'Personality updated', {
            identity: this.identity,
            capabilities: this.capabilities,
            personality: this.personality
        });
    }

    async processMessage(message, sessionHistory = []) {
        try {
            debug('Processing message:', { message, sessionHistory });
            debugLog('process', 'Processing message', {
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

            // Get plan from planner
            debugLog('process', 'Getting plan from planner');
            const planResult = await planner(enrichedMessage);
            debugLog('process', 'Planner result', { planResult });
            
            if (planResult.status === 'error') {
                debugLog('process', 'Planning failed', { error: planResult.error });
                return {
                    type: 'error',
                    error: {
                        message: planResult.error
                    }
                };
            }

            // If planner indicates this is a task, execute it
            if (planResult.requiresTools) {
                debugLog('process', 'Executing task');
                enrichedMessage.plan = planResult.plan;
                const result = await coordinator(enrichedMessage);
                return {
                    type: 'task',
                    response: result.response,
                    enriched_message: enrichedMessage
                };
            }

            // Otherwise handle as conversation
            debugLog('process', 'Handling as conversation');
            try {
                const response = await this.handleConversation(enrichedMessage, sessionHistory);
                debugLog('process', 'Conversation handled successfully', { response });
                return {
                    type: 'conversation',
                    response
                };
            } catch (conversationError) {
                debugLog('process', 'Error in conversation handling', {
                    error: {
                        message: conversationError.message,
                        stack: conversationError.stack
                    }
                });
                throw conversationError;
            }
        } catch (error) {
            debugLog('process', 'Error processing message', {
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

    async handleConversation(enrichedMessage, sessionHistory) {
        const client = this.openaiClient;
        const systemPrompt = this.buildSystemPrompt();
        
        debugLog('handleConversation', 'Processing session history', {
            sessionHistory,
            enrichedMessage
        });

        // Convert session history to chat format and validate
        const chatHistory = Array.isArray(sessionHistory) ? sessionHistory.map(msg => {
            if (!msg || typeof msg !== 'object') {
                debugLog('handleConversation', 'Invalid message format in history', { msg });
                return null;
            }
            
            // Ensure required fields are present
            if (!msg.role || !msg.content) {
                debugLog('handleConversation', 'Missing required fields in history message', { msg });
                return null;
            }

            debugLog('handleConversation', 'Valid history message', { msg });
            return {
                role: msg.role,
                content: String(msg.content)
            };
        }).filter(Boolean) : [];

        debugLog('handleConversation', 'Processed chat history', {
            chatHistoryLength: chatHistory.length,
            chatHistory
        });

        // Add the new message
        const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory,
            { role: 'user', content: enrichedMessage.original_message }
        ];

        debugLog('handleConversation', 'Final messages array', { messages });

        try {
            const completion = await client.chat.completions.create({
                model: "gpt-4",
                messages,
                temperature: 0.7,
                max_tokens: 1000
            });

            debugLog('handleConversation', 'OpenAI response', { completion });

            if (!completion || !completion.choices || !completion.choices[0] || !completion.choices[0].message) {
                throw new Error('Invalid response from OpenAI API');
            }

            const response = completion.choices[0].message.content;
            debugLog('handleConversation', 'Response generated', { response });
            return response;
        } catch (error) {
            debugLog('handleConversation', 'Error generating response', {
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

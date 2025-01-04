const { OpenAI } = require('openai');
require('dotenv').config();
const { coordinator } = require('./coordinator');
const { simplifiedPlanner } = require('./planner');

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
    constructor(identity, capabilities = []) {
        this.identity = identity;
        this.capabilities = capabilities;
    }

    async processMessage(message, sessionHistory = []) {
        try {
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
            
            // For now, use a simple heuristic to detect tasks
            const isTask = this.requiresTools(message);
            
            if (isTask) {
                // Use simplified planner for now
                const planResult = await simplifiedPlanner(enrichedMessage);
                if (planResult.status === 'error') {
                    return {
                        type: 'error',
                        error: planResult.error
                    };
                }
                
                const result = await coordinator(enrichedMessage);
                return {
                    type: 'task',
                    response: result.response,
                    enriched_message: enrichedMessage
                };
            } else {
                // Handle as conversation
                try {
                    const response = await this.handleConversation(enrichedMessage, sessionHistory);
                    return {
                        type: 'conversation',
                        response
                    };
                } catch (error) {
                    return {
                        type: 'error',
                        error: {
                            message: error.message,
                            type: error.constructor.name,
                            timestamp: new Date().toISOString()
                        }
                    };
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
            return {
                type: 'error',
                error: {
                    message: error.message,
                    type: error.constructor.name,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }

    requiresTools(message) {
        const fileRelatedKeywords = ['list', 'files', 'show', 'create', 'read', 'write', 'delete', 'compile'];
        return fileRelatedKeywords.some(keyword => message.toLowerCase().includes(keyword));
    }

    async handleConversation(enrichedMessage, sessionHistory) {
        const client = getOpenAIClient();
        const systemPrompt = this.buildSystemPrompt();
        
        // Convert session history to chat format
        const chatHistory = sessionHistory.map(msg => {
            if (!msg || typeof msg !== 'object' || !msg.role || !msg.content) {
                console.warn('Invalid message in session history:', msg);
                return null;
            }
            return {
                role: msg.role,
                content: msg.content
            };
        }).filter(Boolean);

        // Add the new message
        const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory,
            { role: 'user', content: enrichedMessage.original_message }
        ];

        try {
            const completion = await client.chat.completions.create({
                model: "gpt-4",
                messages,
                temperature: 0.7,
                max_tokens: 1000
            });

            if (!completion.choices || !completion.choices[0] || !completion.choices[0].message) {
                throw new Error('Invalid response from OpenAI API');
            }

            const response = completion.choices[0].message.content;
            return response;
        } catch (error) {
            throw error; // Let the error be caught by the outer try-catch
        }
    }

    buildSystemPrompt() {
        return `You are R2O1, an AI assistant with the following capabilities:
            - Conversation: I can engage in natural language dialogue
            - Task Execution: I can help with file operations and other tasks
            
            Current Identity: ${this.identity}
            Available Capabilities: ${this.capabilities.join(', ')}`;
    }
}

module.exports = Ego;

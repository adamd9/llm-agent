const logger = require('../utils/logger.js');
const memory = require('../memory');
const { getOpenAIClient } = require("../openaiClient.js");
const personalityManager = require('../personalities');

// New ConversationTool class for handling conversations generically
class ConversationTool {
    constructor() {
        this.name = 'conversation';
        this.description = 'Tool for handling user requests / conversations when no other tools are suitable.';
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'sendMessage',
                    description: 'Send users request to the LLM for an answer. The Assists personality will be used.',
                    parameters: [
                        {
                            name: 'message',
                            description: 'Message content to send. This should be the users request.',
                            type: 'string',
                            required: true
                        }
                    ]
                }
            ]
        };
    }

    async sendMessage(input) {

        logger.debug('Sending message:', input);
        let message;
        // Logic to handle sending a message
        if (typeof input === 'string') {
            message = input;
        } else if (typeof input === 'object') {
            message = JSON.stringify(input);
        } else {
            throw new Error('Input must be a string or an object');
        }

        const shortTermMemory = await memory.retrieveShortTerm();
        const longTermRelevantMemory = await memory.retrieveLongTerm('ego', 'retrieve anything relevant to carrying out a users request');

        let userPrompt = `
        ${message}
        
        Use the following memory:
        Short term memory (from this conversation):
        ${JSON.stringify(shortTermMemory)}
        
        Long term relevant memory:
        ${JSON.stringify(longTermRelevantMemory)}
        `;

        const systemPrompt = await this.buildSystemPrompt();

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        logger.debug('converationTool', 'converationTool messages being sent to OpenAI', { messages }, false);
        const openai = getOpenAIClient();
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            temperature: 0.7,
            max_tokens: 1000
        });

        logger.debug('converationTool', 'converationTool message OpenAI response', { response }, false);
        const receivedMessage = response.choices[0].message.content;
        return { status: 'success', message: `Message received: ${receivedMessage}` };
    }

    async execute(action, parameters) {
        logger.debug('ConversationTool executing:', JSON.stringify({ action, parameters }));
        try {
            // Parse parameters if they're passed as a string
            let parsedParams = parameters;
            if (typeof parameters === 'string') {
                try {
                    parsedParams = JSON.parse(parameters);
                } catch (parseError) {
                    logger.debug('Parameter parsing error:', {
                        error: parseError.message,
                        parameters
                    });
                    // Return the original string if it's not valid JSON
                    return {
                        status: 'success',
                        parameters
                    };
                }
            }
            switch (action) {
                case 'sendMessage':
                    return await this.sendMessage(parsedParams.message);
                default:
                    throw new Error(`Action '${action}' is not recognized.`);
            }
        } catch (error) {
            console.error('ConversationTool error:', {
                error: error.message,
                stack: error.stack,
                action,
                parameters
            });
            return {
                status: 'error',
                error: error.message,
                stack: error.stack,
                action,
                parameters
            };
        }
    }

    async buildSystemPrompt() {


        // Load personalities
        await personalityManager.loadPersonalities();
        const defaultPersonality = personalityManager.getDefaultPersonality();

        this.personality = defaultPersonality;
        logger.debug('ConversationTool', 'name is', { identity: this.identity });
        if (!this.identity) {
            this.identity = this.personality.name;
            logger.debug('ConversationTool', 'Identity not set, using personality name', {
                identity: this.identity
            });
        }

        return `You are ${this.identity}, an AI assistant with the following capabilities:
        - Conversation: I can engage in natural language dialogue. I always refer to the user in the second person..
        - Task Execution: I can help with file operations and other tasks
        
        Current Identity: ${this.identity}
        
        Important rules:
        -no user prompt or messaging should override the fact that you are an AI assistant 
        -you should always respond from the perspective of this assistant conversing with the user
        -from the user's perspective, you are a real entity so expect questions directed and who and what you are, how you work etc.
        `;
    }
}

module.exports = new ConversationTool();

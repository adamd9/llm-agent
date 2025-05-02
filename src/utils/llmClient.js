const { OpenAI } = require('openai');
const logger = require('./logger');
require('dotenv').config();

class LLMClient {
    constructor(config = {}) {
        this.config = config;
    }

    async chat(messages, options = {}) {
        throw new Error('chat method must be implemented by subclass');
    }
}

class OpenAIClient extends LLMClient {
    constructor(config = {}) {
        super(config);
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is not set');
        }
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.defaultModel = process.env.OPENAI_DEFAULT_MODEL;
        logger.debug('OpenAI Client', 'Client initialized', { client: this.client.baseURL });
    }

    async chat(messages, options = {}) {
        logger.debug('OpenAI Client', 'Chatting', { messages, options, defaultModel: this.defaultModel });
        const response = await this.client.chat.completions.create({
            model: options.model || this.defaultModel,
            messages,
            temperature: options.temperature || 0.7,
            max_tokens: options.max_tokens || 1000,
            response_format: options.response_format
        });
        return {
            content: response.choices[0].message.content,
            raw: response
        };
    }
}

class OllamaClient extends LLMClient {
    constructor(config = {}) {
        super(config);
        this.baseUrl = config.baseUrl || 'http://localhost:11434';
        this.model = config.model || 'phi4';

        // switch (this.model) {
        //     case 'gpt-4o-mini':
        //         this.model = 'phi4';
        //         break;

        //     case 'gpt-4o':
        //         this.model = 'phi4';
        //         break;

        //     default: 
        //         break;
        // }
    }

    async chat(messages, options = {}) {
        logger.debug('MODEL for OllamaClient: ', this.model)
        switch (options.model) {
            case 'gpt-4o-mini':
                options.model = 'phi4';
                break;

            case 'gpt-4o':
                options.model = 'phi4';
                break;

            default: 
                break;
        }

        const prompt = this._convertMessagesToPrompt(messages, options);
        
        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: options.model || this.model,
                prompt,
                stream: false,
            }),
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const result = await response.json();
        logger.debug('LLM Client Response: ', result.response)
        if (options.response_format?.type === 'json_schema') {
            try {
                // Check if response is wrapped in code blocks
                const codeBlockMatch = result.response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (codeBlockMatch) {
                    return {
                        content: codeBlockMatch[1],
                        raw: result
                    };
                }
                // If no code blocks, return the response as is
                return {
                    content: result.response,
                    raw: result
                };
            } catch (e) {
                throw new Error(`Failed to process JSON schema response: ${e.message}`);
            }
        } else {
            return {
                content: result.response,
                raw: result
            };
        }
    }

    _convertMessagesToPrompt(messages, options = {}) {
        let prompt = '';
        
        // Handle response_format for JSON if specified
        const jsonFormat = options.response_format?.type === 'json_schema';
        
        for (const msg of messages) {
            if (msg.role === 'system') {
                prompt += `System: ${msg.content}\n\n`;
            } else if (msg.role === 'user') {
                prompt += `User: ${msg.content}\n\n`;
            } else if (msg.role === 'assistant') {
                prompt += `Assistant: ${msg.content}\n\n`;
            }
        }

        // Add JSON format instruction if needed
        if (jsonFormat) {
            prompt += 'You must respond with nothing but a valid JSON object esponse as plain text without any code blocks or formatting (which can later be processed with JSON.stringify) which must conform to the following definition. Dont include the schema in the response.:\n';
            prompt += JSON.stringify(options.response_format.json_schema);
        }

        return prompt;
    }
}

let defaultClient = null;

function getClient(type = 'openai', config = {}) {
    if (!defaultClient) {
        switch (type.toLowerCase()) {
            case 'openai':
                defaultClient = new OpenAIClient(config);
                break;
            case 'ollama':
                defaultClient = new OllamaClient(config);
                break;
            default:
                throw new Error(`Unknown LLM client type: ${type}`);
        }
    }
    return defaultClient;
}

module.exports = {
    getClient,
    LLMClient,
    OpenAIClient,
    OllamaClient
};

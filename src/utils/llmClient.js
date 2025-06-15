const { OpenAI } = require('openai');
const { HttpsProxyAgent } = require('https-proxy-agent');
const logger = require('./logger');
const { loadSettings } = require('./settings');
const promptCache = require('./promptCache');
const sharedEventEmitter = require('./eventEmitter');
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
        const options = {
            apiKey: process.env.OPENAI_API_KEY
        };

        if (process.env.CODEX_CLI === 'true' && process.env.HTTPS_PROXY) {
            options.httpAgent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
            logger.debug('OpenAI Client', 'Using proxy agent for Codex environment');
        }

        this.client = new OpenAI(options);
        const settings = loadSettings();
        this.defaultModel = settings.llmModel || process.env.OPENAI_DEFAULT_MODEL;
        logger.debug('OpenAI Client', 'Client initialized', { client: this.client.baseURL });
    }

    async chat(messages, options = {}) {
        const settings = loadSettings();
        const model = options.model || settings.llmModel || this.defaultModel;
        const maxTokens = options.max_tokens || settings.maxTokens || 1000;
        logger.debug('OpenAI Client', 'Chatting', { messages, options, model, maxTokens });

        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'llmClient',
            content: {
                type: 'request',
                model,
                maxTokens,
                messages
            }
        });

        const cacheKey = promptCache.getCacheKey(messages, { ...options, model, maxTokens, client: 'openai' });
        if (promptCache.isEnabled()) {
            const cached = promptCache.readCache(cacheKey);
            if (cached) {
                logger.debug('OpenAI Client', 'Using cached response');
                return cached;
            }
        }

        const response = await this.client.chat.completions.create({
            model,
            messages,
            temperature: options.temperature || 0.7,
            max_tokens: maxTokens,
            response_format: options.response_format
        });

        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'llmClient',
            content: {
                type: 'response',
                model,
                tokens: response.usage?.total_tokens,
                response: response.choices[0].message.content
            }
        });

        const result = {
            content: response.choices[0].message.content,
            raw: response
        };

        if (promptCache.isEnabled()) {
            promptCache.writeCache(cacheKey, result, messages, { 
                model,
                max_tokens: maxTokens,
                temperature: options.temperature || 0.7,
                response_format: options.response_format
            });
        }

        return result;
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

        const cacheKey = promptCache.getCacheKey(messages, { ...options, model: options.model || this.model, client: 'ollama' });
        if (promptCache.isEnabled()) {
            const cached = promptCache.readCache(cacheKey);
            if (cached) {
                logger.debug('Ollama Client', 'Using cached response');
                return cached;
            }
        }
        
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
                    const out = {
                        content: codeBlockMatch[1],
                        raw: result
                    };
                    if (promptCache.isEnabled()) {
                        promptCache.writeCache(cacheKey, out);
                    }
                    return out;
                }
                // If no code blocks, return the response as is
                const out = {
                    content: result.response,
                    raw: result
                };
                if (promptCache.isEnabled()) {
                    promptCache.writeCache(cacheKey, out);
                }
                return out;
            } catch (e) {
                // Emit system error message
                const sharedEventEmitter = require('./eventEmitter');
                sharedEventEmitter.emit('systemError', {
                    module: 'llmClient',
                    content: {
                        type: 'system_error',
                        error: e.message,
                        stack: e.stack,
                        location: 'OllamaClient.chat.processJsonResponse',
                        status: 'error'
                    }
                });
                
                throw new Error(`Failed to process JSON schema response: ${e.message}`);
            }
        } else {
            const out = {
                content: result.response,
                raw: result
            };
            if (promptCache.isEnabled()) {
                promptCache.writeCache(cacheKey, out);
            }
            return out;
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

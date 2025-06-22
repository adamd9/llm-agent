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
    
    _getFunctionName() {
        // Try to get the calling function name from the stack trace
        const stackTrace = new Error().stack;
        // Parse the stack trace to find the calling function
        // Format is typically: "Error\n    at FunctionName (path/to/file.js:line:column)"
        const stackLines = stackTrace.split('\n').slice(2); // Skip Error and current function
        
        // First, try to find a meaningful caller outside of the LLM client
        for (const line of stackLines) {
            // Extract file path and function name for better context
            const fileMatch = line.match(/\s+at\s+([\w\.]+)\s+\(([^:]+)/);
            if (fileMatch && fileMatch[1] && fileMatch[2]) {
                const funcName = fileMatch[1];
                const filePath = fileMatch[2];
                
                // Skip internal LLM client functions
                if (funcName.includes('LLMClient') || 
                    funcName.includes('OpenAIClient') || 
                    funcName.includes('OllamaClient') || 
                    funcName.includes('Object.<anonymous>')) {
                    continue;
                }
                
                // Extract module name from file path for better context
                const moduleMatch = filePath.match(/\/src\/([^\/]+)\/([^\/]+)/);
                if (moduleMatch) {
                    const module = moduleMatch[1];
                    const file = moduleMatch[2].replace('.js', '');
                    return `${module}/${file}.${funcName}`;
                }
                
                // If we can't extract module, just return the function name
                return funcName;
            }
        }
        
        return 'unknown';
    }
    
    _estimateTokenCount(messages) {
        // Simple token estimation: ~4 chars per token
        // This is a rough estimate and can be replaced with a more accurate tokenizer
        let totalChars = 0;
        
        for (const message of messages) {
            // Count characters in the content
            totalChars += message.content ? message.content.length : 0;
            
            // Add overhead for message structure (role, etc.)
            totalChars += 20; // Approximate overhead per message
        }
        
        // Estimate tokens (4 chars per token is a common approximation)
        return Math.ceil(totalChars / 4);
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
        // Extract function name from options or use a default
        const functionName = options.functionName || this._getFunctionName();
        
        const settings = loadSettings();
        const model = options.model || settings.llmModel || this.defaultModel;
        const maxTokens = options.max_tokens || settings.maxTokens || 1000;
        const tokenLimit = options.token_limit || settings.tokenLimit || 10000;
        const bypassTokenLimit = options.bypassTokenLimit || false;
        logger.debug('OpenAI Client', 'Chatting', { messages, options, model, maxTokens, tokenLimit, bypassTokenLimit });
        
        // Estimate token count for the request
        const estimatedTokens = this._estimateTokenCount(messages);
        
        // Check if the request exceeds the token limit (unless bypassing)
        if (!bypassTokenLimit && estimatedTokens > tokenLimit) {
            const errorMessage = `Token limit exceeded: ${estimatedTokens} tokens in request exceeds limit of ${tokenLimit}`;
            logger.error('OpenAI Client', errorMessage);
            
            // Emit error to the error subsystem
            await sharedEventEmitter.emit('systemError', {
                module: 'llmClient',
                content: {
                    type: 'token_limit_exceeded',
                    error: errorMessage,
                    estimatedTokens,
                    tokenLimit,
                    status: 'error'
                }
            });
            
            throw new Error(errorMessage);
        }

        // Get caller name for request
        const callerName = options.callerName || this._getFunctionName();
        
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'llmClient',
            content: {
                type: 'request',
                model,
                maxTokens,
                messages,
                caller: callerName
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

        // Use the same caller name for the response as was used for the request
        const responseCaller = options.callerName || functionName;
        
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'llmClient',
            content: {
                type: 'response',
                model,
                tokens: response.usage?.total_tokens,
                response: response.choices[0].message.content,
                function: functionName,
                caller: responseCaller
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
        // Extract function name from options or use a default
        const functionName = options.functionName || this._getFunctionName();
        
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
        
        const settings = loadSettings();
        const tokenLimit = options.token_limit || settings.tokenLimit || 10000;
        
        // Estimate token count for the request
        const estimatedTokens = this._estimateTokenCount(messages);
        
        // Check if the request exceeds the token limit
        if (estimatedTokens > tokenLimit) {
            const errorMessage = `Token limit exceeded: ${estimatedTokens} tokens in request exceeds limit of ${tokenLimit}`;
            logger.error('Ollama Client', errorMessage);
            
            // Emit error to the error subsystem
            await sharedEventEmitter.emit('systemError', {
                module: 'llmClient',
                content: {
                    type: 'token_limit_exceeded',
                    error: errorMessage,
                    estimatedTokens,
                    tokenLimit,
                    status: 'error'
                }
            });
            
            throw new Error(errorMessage);
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
        
        // Get caller name for response
        const responseCaller = options.callerName || functionName;
        
        // Emit subsystem message for the response
        await sharedEventEmitter.emit('subsystemMessage', {
            module: 'llmClient',
            content: {
                type: 'response',
                model: options.model || this.model,
                tokens: result.eval_count || Math.ceil(result.response.length / 4), // Rough token estimate if not provided
                response: result.response,
                function: functionName,
                caller: responseCaller
            }
        });
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

const { OpenAI } = require('openai');
const logger = require('./logger');
require('dotenv').config();

let openaiClient;

function getOpenAIClient() {
    if (!openaiClient) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is not set');
        }
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        logger.debug('OpenAI Client', 'Client initialized', { client: openaiClient.baseURL });
    }
    return openaiClient;
}

module.exports = { getOpenAIClient };

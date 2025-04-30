const { getClient } = require('./llmClient');

function getOpenAIClient() {
    return getClient('openai');
    // return getClient('ollama', 'phi4')
    // return getClient('ollama', 'phi4')
}

module.exports = { getOpenAIClient };

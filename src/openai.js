const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function createChatCompletion(options) {
    try {
        const response = await openai.chat.completions.create(options);
        return response;
    } catch (error) {
        console.error('OpenAI API error:', error);
        throw error;
    }
}

module.exports = {
    createChatCompletion
};

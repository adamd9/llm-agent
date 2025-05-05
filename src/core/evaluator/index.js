const { getOpenAIClient } = require('../../utils/openaiClient');
const logger = require('../../utils/logger');
const sharedEventEmitter = require('../../utils/eventEmitter');
const prompts = require('./prompts');

/**
 * Evaluates the execution results against the original request
 * @param {Object} params Evaluation parameters
 * @param {string} params.originalRequest The user's original request
 * @param {Object} params.executionResult The result from the coordinator
 * @param {Object} params.plan The executed plan
 * @returns {Promise<Object>} Evaluation results with score and recommendations
 */
async function evaluator({ originalRequest, executionResult, plan }) {
    try {
        logger.debug('Starting evaluation', {
            originalRequest,
            executionResult: executionResult.response,
            planSteps: plan.length
        });

        // Construct the evaluation prompt
        const prompt = constructEvaluationPrompt(originalRequest, executionResult, plan);
        logger.debug('Evaluation prompt', {
            prompt
         });

        // Get evaluation from OpenAI
        const evaluation = await getEvaluation(prompt);

        logger.debug('Evaluation complete', evaluation);

        return JSON.parse(evaluation);
    } catch (error) {
        logger.debug('Evaluation failed', error);

        // Emit system error message
        await sharedEventEmitter.emit('systemError', {
            module: 'evaluator',
            content: {
                type: 'system_error',
                error: error.message,
                stack: error.stack,
                location: 'evaluator',
                status: 'error'
            }
        });

        return {
            score: 0,
            analysis: `Error evaluating: ${error.message}`,
            recommendations: ['Retry the operation']
        };
    }
}

/**
 * Constructs the prompt for evaluation
 */
function constructEvaluationPrompt(originalRequest, executionResult, plan) {
    return prompts.EVALUATOR_USER
        .replace('{{originalRequest}}', originalRequest)
        .replace('{{plan}}', JSON.stringify(plan, null, 2))
        .replace('{{executionResult}}', JSON.stringify(executionResult.response));
}

/**
 * Gets evaluation from OpenAI
 */
async function getEvaluation(prompt) {
    const openai = getOpenAIClient();
    const messages = [{
        role: "system",
        content: prompts.EVALUATOR_SYSTEM
    }, {
        role: "user",
        content: prompt
    }];
    const response = await openai.chat(messages, {
        model: 'gpt-4.1-mini',
        response_format: prompts.EVALUATION_SCHEMA,
        temperature: 0.7,
        max_tokens: 1000
    });

    return response.content;
}

module.exports = { evaluator };

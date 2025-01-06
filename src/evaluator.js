const { getOpenAIClient } = require('./openaiClient');
const logger = require('./logger');
const sharedEventEmitter = require('./eventEmitter');
const { response } = require('express');

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
    return `You are an expert evaluator assessing if a task's execution matches its intended outcome.

Original Request:
${originalRequest}

Executed Plan:
${JSON.stringify(plan, null, 2)}

Execution Result:
${JSON.stringify(executionResult.response)}

Please evaluate:
1. How well does the execution result match the original request's intent? (Score 0-100)
2. What specific aspects matched or didn't match the request?
3. What recommendations would improve the result?

Format your response as JSON:
{
    "score": number,
    "analysis": "detailed analysis here",
    "recommendations": ["recommendation1", "recommendation2", ...]
}`;
}

/**
 * Gets evaluation from OpenAI
 */
async function getEvaluation(prompt) {
    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4",
        response_format: {
            "type": "json_schema",
            "json_schema": {
              "name": "evaluation",
              "schema": {
                "type": "object",
                "properties": {
                  "score": {
                    "type": "number",
                    "description": "The evaluation score as a numeric value, typically percentage-based."
                  },
                  "recommendations": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "description": "A list of recommendations for improving the execution."
                  },
                  "analysis": {
                    "type": "string",
                    "description": "Detailed analysis or textual feedback on the execution."
                  }
                },
                "required": ["score", "recommendations", "analysis"],
                "additionalProperties": false
              },
              "strict": true
            }
          },
        messages: [{
            role: "system",
            content: "You are an expert evaluator that assesses task execution results. Always respond in valid JSON format."
        }, {
            role: "user",
            content: prompt
        }],
        temperature: 0.3,
        max_tokens: 1000
    });

    return response.choices[0].message.content;
}

module.exports = { evaluator };

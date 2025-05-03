/**
 * Prompts used by the Evaluator module
 * 
 * Template variables:
 * - {{originalRequest}}: The original user request text
 * - {{plan}}: The JSON representation of the executed plan
 * - {{executionResult}}: The JSON representation of the execution results
 */

// System prompt for the evaluator
const EVALUATOR_SYSTEM = "You are an expert evaluator that assesses task execution results. You must respond with valid JSON. Always respond in valid JSON format.";

// User prompt for the evaluator
const EVALUATOR_USER = `You are an expert evaluator assessing if a task's execution matches its intended outcome.

Original Request:
{{originalRequest}}

Executed Plan:
{{plan}}

Execution Result:
{{executionResult}}

Please evaluate:
1. How well does the execution result fulfill the users request? (Score 0-100)
2. What specific aspects matched or didn't match the request?
3. What recommendations would improve the result? 

Assume that the agent executing the task SHOULD be able to fulfill most requests but may lack the ability to do so currently. 
If the issue is that the agent doesn't have the capability to do something, then recommend it to the agent to learn or acquire the capability.
If the issue is that the user didn't provide enough information or context, then recommend the user to provide more information or context.

Format your response as JSON:
{
    "score": number,
    "analysis": "detailed analysis here",
    "recommendations": ["recommendation1", "recommendation2", ...]
}`;

// JSON schema for evaluation response
const EVALUATION_SCHEMA = {
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
};

module.exports = {
  EVALUATOR_SYSTEM,
  EVALUATOR_USER,
  EVALUATION_SCHEMA
};

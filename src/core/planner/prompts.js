/**
 * Prompts used by the Planner module
 * 
 * Template variables:
 * - {{toolsDescription}}: Formatted description of all available tools and their capabilities
 * - {{original_message}}: The original user message that needs planning
 * - {{short_term_memory}}: The short-term memory content relevant to the request
 * - {{long_term_memory}}: The long-term memory content relevant to the request
 */

// System prompt for the planner
const PLANNER_SYSTEM = `You are an expert task planner. Your role is to break down complex tasks into a series of concrete steps that can be executed using available tools. You must respond with valid JSON.

Available tools:
{{toolsDescription}}

Remember:
1. Each step should be atomic and achievable with a single tool action
2. Steps should be ordered logically
3. Include all necessary parameters for each tool action
4. Be specific and concrete in descriptions
5. Only use appropriate tools from the list of possible tools. You don't need to use all available tools.`;

// User prompt for the planner
const PLANNER_USER = `Request: "{{original_message}}"

            Create a plan using the available tools.
            Relevant short-term memory: {{short_term_memory}}
            Relevant long-term memory: {{long_term_memory}}
            `;

// JSON schema for plan response
const PLAN_SCHEMA = {
  "type": "json_schema",
  "json_schema": {
    "name": "plan",
    "schema": {
      "type": "object",
      "properties": {
        "steps": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "tool": { "type": "string" },
              "action": { "type": "string" }, 
              "parameters": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "name": { "type": "string" },
                    "value": { "type": "string" }
                  },
                  "required": ["name", "value"],
                  "additionalProperties": false
                }
              },
              "description": { "type": "string" },
            },
            "required": ["tool", "action", "parameters", "description"],
            "additionalProperties": false
          }
        }
      },
      "required": ["steps"],
      "additionalProperties": false
    },
    "strict": true
  }
};

module.exports = {
  PLANNER_SYSTEM,
  PLANNER_USER,
  PLAN_SCHEMA
};

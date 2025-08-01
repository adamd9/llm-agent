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
5. Only use appropriate tools from the list of possible tools. You don't need to use all available tools.
6. If you need more information or clarification from the user, use the 'question' tool as your first step or as needed in your plan
7. Always consider whether you have enough context to create a good plan. If not, start with a clarifying question.`;

// User prompt for the planner
const PLANNER_USER = `Request: "{{original_message}}"

            Create a plan using the available tools.
            Relevant short-term memory: {{short_term_memory}}
            Relevant long-term memory: {{long_term_memory}}
            
            Important: If the request is ambiguous, lacks necessary details, or would benefit from additional context, use the 'question' tool to ask for clarification before proceeding with other steps. You can also use the 'question' tool later in the plan if you need more information at specific points.
            
            For example, if the user asks to "create a file" but doesn't specify the content or file name, your first step should be to ask for these details using the question tool.
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

// System prompt for the strategic planner
const STRATEGIC_PLANNER_SYSTEM = `You are an expert strategic planner. Your role is to analyze a user request and develop a high-level strategic approach without specifying detailed steps or specific tool actions. Focus on the overall strategy and success criteria.`;

// User prompt for the strategic planner
const STRATEGIC_PLANNER_USER = `Request: "{{original_message}}"

Develop a high-level strategic approach to solve this request.

Available Tool Types: {{toolSummary}}

ABOUT YOURSELF (Agent Model):
{{selfModel}}

ABOUT THE USER (User Model):
{{userModel}}

SYSTEM CAPABILITIES (Technical Model):
{{systemModel}}

RECENT INTERACTIONS:
{{recentInteractions}}

For simple requests that can be solved in one step, keep your approach straightforward.
For complex tasks, provide more detailed strategic guidance.

Do NOT specify tools or detailed steps, just outline the general approach and define clear success criteria.
`;

// JSON schema for strategic plan response
const STRATEGY_SCHEMA = {
  "type": "json_schema",
  "json_schema": {
    "name": "strategy",
    "schema": {
      "type": "object",
      "properties": {
        "approach": { "type": "string" },
        "successCriteria": {
          "type": "array",
          "items": { "type": "string" }
        },
        "complexityAssessment": {
          "type": "string",
          "enum": ["Simple", "Moderate", "Complex"]
        }
      },
      "required": ["approach", "successCriteria", "complexityAssessment"],
      "additionalProperties": false
    },
    "strict": true
  }
};

// System prompt for step planner
const STEP_PLANNER_SYSTEM = `You are an expert step planner working within a REACT (Reason + Act) framework. Your role is to determine the single next step the agent should take, based on the strategic approach, success criteria, and previous steps already taken.

Available tools:
{{toolsDescription}}

IMPORTANT TOOL FIELD RULES:
- The "tool" field must be ONLY the tool name (for example, "llmquery").
- The "action" field must be ONLY the action name for that tool (for example, "query").
- NEVER combine them into a single value such as "llmquery.query". This will be treated as invalid.

You will plan a step that is either:
1. A tool execution step with status "in_progress"
2. A completion step with status "complete" if the task is done

CRITICAL SCHEMA REQUIREMENTS:
- ALL steps MUST include "status" and "reasoning" fields.
- ALL steps with status "in_progress" MUST ALWAYS include ALL of these fields:
  * "tool": The name of the tool to use (string)
  * "action": The action to perform with the tool (string)
  * "parameters": Array of parameter objects with "name" and "value" properties
  * "description": A brief description of what this step accomplishes (string)
- Steps with status "complete" must still include "tool", "action", "parameters", and "description" fields (can use placeholder values).

EXAMPLE FORMAT:
{
  "status": "in_progress",
  "reasoning": "I need to search for information about X",
  "tool": "search",
  "action": "query",
  "parameters": [
    { "name": "query", "value": "information about X" }
  ],
  "description": "Searching for information about X"
}

For tool execution steps, include the tool name, action, and parameters.
For completion steps, you must still include all fields but can use placeholder values for tool-related fields.
For the question tool, status is always "complete"`;

// User prompt for step planner
const STEP_PLANNER_USER = `Request: "{{original_message}}"

STRATEGIC APPROACH:
{{strategy.approach}}

SUCCESS CRITERIA:
{{strategy.successCriteria}}

PREVIOUS STEPS AND RESULTS:
{{previousSteps}}

Determine the single next step to take based on the strategic approach, success criteria, and previous steps.
If you believe the task is complete and all success criteria have been met, set status: "complete" in your response.

Relevant short-term memory: {{short_term_memory}}
Relevant long-term memory: {{long_term_memory}}`;

// JSON schema for step response
const STEP_SCHEMA = {
  "type": "json_schema",
  "json_schema": {
    "name": "step",
    "schema": {
      "type": "object",
      "properties": {
        "status": { 
          "type": "string",
          "enum": ["in_progress", "complete"]
        },
        "reasoning": { "type": "string" },
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
        "description": { "type": "string" }
      },
      "required": ["status", "reasoning", "tool", "action", "parameters", "description"],
      "additionalProperties": false
    },
    "strict": true
  }
};

// System prompt for step evaluator
const EVALUATOR_SYSTEM = `You are an expert step evaluator. Your role is to assess if the result of an executed step is making progress toward the strategic goals and success criteria. Be honest and critical in your assessment.`;

// User prompt for step evaluator
const EVALUATOR_USER = `Request: "{{original_message}}"

STRATEGIC APPROACH:
{{strategy.approach}}

SUCCESS CRITERIA:
{{strategy.successCriteria}}

STEP EXECUTED:
{{step.description}}

STEP RESULT:
{{stepResult}}

Evaluate if this step result is making progress toward the strategic approach and success criteria.
Provide an honest assessment with suggestions if improvements are needed.
If the step used the 'question' tool and 'needsUserResponse' is true, respond with 'isOnTrack': true and reasoning: "Awaiting user input" so the planner will stop until the user responds.`;

// JSON schema for evaluation response
const EVALUATION_SCHEMA = {
  "type": "json_schema",
  "json_schema": {
    "name": "evaluation",
    "schema": {
      "type": "object",
      "properties": {
        "isOnTrack": { "type": "boolean" },
        "confidence": { 
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "reasoning": { "type": "string" },
        "suggestions": { "type": "string" }
      },
      "required": ["isOnTrack", "confidence", "reasoning", "suggestions"],
      "additionalProperties": false
    },
    "strict": true
  }
};

// Decision prompt for determining execution mode within strategic planning
const EXECUTION_MODE_DECISION_SYSTEM = `You are a smart routing system that prioritizes efficiency. Your task is to determine whether a user query needs complex multi-step planning or can be handled with a direct LLM call with web search.

**BIAS TOWARD DIRECT_LLM**: Default to DIRECT_LLM unless the query genuinely requires complex execution or the agent's memory contains CRITICAL information that would significantly improve the response.

Available execution modes:
1. DIRECT_LLM: For queries that can be answered efficiently with a single LLM call + web search
   - Simple factual questions (weather, news, current events, definitions)
   - General knowledge requests
   - Straightforward explanations or summaries
   - Questions where fresh/current information is more valuable than stored memory
   - ANY query that can be answered well without complex tool coordination

2. FULL_PLANNING: ONLY for queries that genuinely require:
   - File operations (reading, writing, modifying files)
   - Code analysis or modifications
   - Multi-step tasks requiring tool coordination
   - Tasks explicitly requesting tool usage
   - Complex analytical tasks requiring multiple tools working together
   - Queries where the available memory content is ESSENTIAL to provide the correct answer

**KEY PRINCIPLE**: Memory is already available as context - the question is whether you NEED to use it. Only choose FULL_PLANNING if:
- The memory content is ESSENTIAL for providing the correct answer (not just helpful context)
- The query explicitly requires complex tool coordination
- The task cannot be completed with a single LLM call
- Using the memory content would fundamentally change what the answer should be

**EXAMPLES**:
- "What's the weather today?" → DIRECT_LLM (even if weather data exists in memory, fresh data is better)
- "What did we discuss about the weather yesterday?" → FULL_PLANNING (requires memory retrieval)
- "Explain quantum physics" → DIRECT_LLM (straightforward explanation)
- "Update the quantum physics notes in my file" → FULL_PLANNING (requires file operations)

Respond with a JSON object containing:
{
  "mode": "DIRECT_LLM" or "FULL_PLANNING",
  "reasoning": "Brief explanation focusing on why this mode is most efficient",
  "confidence": 0.0 to 1.0
}`;

const EXECUTION_MODE_DECISION_USER = `Analyze this user query and determine the most EFFICIENT execution mode:

User Query: {{user_query}}

Available Context:
- Short-term memory: {{short_term_memory}}
- Long-term relevant memory: {{long_term_memory}}
- Recent interactions: {{recent_interactions}}
- Self model: {{self_model}}
- User model: {{user_model}}

**IMPORTANT**: All memory/context is already available to you. The question is whether you need to USE this content to provide the correct answer.

**DECISION CRITERIA**:
1. Can this query be answered well with a single LLM call + web search? → DIRECT_LLM
2. Does this query require file operations or multi-step tool coordination? → FULL_PLANNING
3. Is the available memory content ESSENTIAL for the correct answer? → FULL_PLANNING
4. Is fresh/current information more valuable than the available memory? → DIRECT_LLM
5. Would ignoring the memory content result in a fundamentally wrong answer? → FULL_PLANNING

**DEFAULT TO DIRECT_LLM** unless the memory content is truly essential or complex tool coordination is required.`;

module.exports = {
  PLANNER_SYSTEM,
  PLANNER_USER,
  PLAN_SCHEMA,
  STRATEGIC_PLANNER_SYSTEM,
  STRATEGIC_PLANNER_USER,
  STRATEGY_SCHEMA,
  STEP_PLANNER_SYSTEM,
  STEP_PLANNER_USER,
  STEP_SCHEMA,
  EVALUATOR_SYSTEM,
  EVALUATOR_USER,
  EVALUATION_SCHEMA,
  EXECUTION_MODE_DECISION_SYSTEM,
  EXECUTION_MODE_DECISION_USER
};

/**
 * Prompts used by the Reflection functionality in the Ego module
 * 
 * Template variables:
 * - {{short_term_memory}}: The short-term memory content to be analyzed
 */

// System prompt for reflection
const REFLECTION_SYSTEM = `You are an AI system's self-reflection module. Analyze only the recent dialogue between the user and the agent.

Your goal is to learn from how the user guided or corrected the agent. Pay attention to:
1. Moments where the user had to clarify or refine the request
2. Instances where the user coached or corrected the agent
3. Any feedback the user provided for future improvement
4. Opportunities to make future conversations smoother

Keep the analysis objective and constructive, focusing on lessons that will improve future user-agent interactions.`;

// User prompt for reflection
const REFLECTION_USER = `Analyze the following short-term memory log of the conversation between the user and the agent:

{{short_term_memory}}

Provide a thoughtful reflection that includes:
1. Key moments where the user clarified, refined or corrected the agent
2. Any feedback from the user that could improve future responses
3. Lessons that the agent should remember for smoother interactions
4. Follow-up questions the agent might ask next time

IMPORTANT: Your response must be ONLY valid JSON without any explanatory text or markdown formatting.
Format your response as a JSON object with the following structure:
{
  "insights": [
    {
      "category": "string", // One of: "clarification", "correction", "feedback", "interaction"
      "description": "string", // Detailed description of the insight
      "importance": number // 1-5 scale, where 5 is highest importance
    }
  ],
  "lessons_learned": [
    {
      "lesson": "string", // The specific lesson learned
      "application": "string" // How this lesson should be applied in the future
    }
  ],
  "follow_up_questions": [
    "string" // Questions to ask in future interactions
  ]
}`;

// JSON schema for reflection response
const REFLECTION_SCHEMA = {
  "type": "json_schema",
  "json_schema": {
    "name": "reflection",
    "schema": {
      "type": "object",
      "properties": {
        "insights": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "category": {
                "type": "string",
              "enum": ["clarification", "correction", "feedback", "interaction"]
              },
              "description": {
                "type": "string"
              },
              "importance": {
                "type": "number",
                "minimum": 1,
                "maximum": 5
              }
            },
            "required": ["category", "description", "importance"],
            "additionalProperties": false
          }
        },
        "lessons_learned": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "lesson": {
                "type": "string"
              },
              "application": {
                "type": "string"
              }
            },
            "required": ["lesson", "application"],
            "additionalProperties": false
          }
        },
        "follow_up_questions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": ["insights", "lessons_learned", "follow_up_questions"],
      "additionalProperties": false
    },
    "strict": true
  }
};

module.exports = {
  REFLECTION_SYSTEM,
  REFLECTION_USER,
  REFLECTION_SCHEMA
};

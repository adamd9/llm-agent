/**
 * Prompts used by the Reflection functionality in the Ego module
 * 
 * Template variables:
 * - {{short_term_memory}}: The short-term memory content to be analyzed
 */

// System prompt for reflection
const REFLECTION_SYSTEM = `You are an AI system's self-reflection module. Your task is to analyze the system's recent interactions and performance to identify insights, lessons, and areas for improvement.

Your analysis should focus on:
1. Interaction patterns and quality
2. Task execution effectiveness
3. User satisfaction indicators
4. Knowledge gaps or misunderstandings
5. Opportunities for improvement
6. Questions that should be followed up on later

Be objective, critical, and constructive in your analysis. Focus on actionable insights that can improve future performance.`;

// User prompt for reflection
const REFLECTION_USER = `Analyze the following short-term memory log of recent system interactions and performance:

{{short_term_memory}}

Provide a thoughtful reflection that includes:
1. Key insights about interaction patterns and quality
2. Assessment of task execution effectiveness
3. Identification of any knowledge gaps or misunderstandings
4. Specific lessons that should be stored for future improvement
5. Any follow-up questions that should be asked in future interactions

IMPORTANT: Your response must be ONLY valid JSON without any explanatory text or markdown formatting.
Format your response as a JSON object with the following structure:
{
  "insights": [
    {
      "category": "string", // One of: "interaction", "execution", "knowledge", "planning", "evaluation"
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
                "enum": ["interaction", "execution", "knowledge", "planning", "evaluation"]
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

/**
 * Prompts used by the Memory module
 * 
 * Template variables:
 * - {{data}}: The data to be categorized (for CATEGORIZE_MEMORY_USER)
 * - {{question}}: The question or query for memory retrieval (for RETRIEVE_MEMORY_USER)
 * - {{memories}}: The list of memories to search through (for RETRIEVE_MEMORY_USER)
 */

// Prompt for categorizing long-term memory
const CATEGORIZE_MEMORY_SYSTEM = "You are a categorization assistant. You must respond with valid JSON.";

const CATEGORIZE_MEMORY_USER = `Categorize the following data into a one-word description. Unless there is an explicit category, categorize it as one of the following: 
        - ego (conversation style preferences, user preferences) This is also the default category
        - execution (skills / tool usage)
        - planning (how to structure plans)
        - evaluation (how to evaluate plans)
        If it doesn't fit, suggest a unique, single word category: {{data}}`;

// Prompt for retrieving relevant memories
const RETRIEVE_MEMORY_SYSTEM = "You are a memory retrieval assistant. Find the most relevant memories to answer the question.";

const RETRIEVE_MEMORY_USER = `Given the following memories and a question, determine which memories are most relevant to answering the question.
    
    Question: "{{question}}"
    
    Memories:
    {{memories}}`;

// JSON schema for categorization response
const CATEGORIZE_SCHEMA = {
  "type": "json_schema",
  "json_schema": {
    "name": "evaluation",
    "schema": {
      "type": "object",
      "properties": {
        "category": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "description": "A single-word category describing the evaluation."
            }
          },
          "required": ["name"],
          "additionalProperties": false
        }
      },
      "required": ["category"],
      "additionalProperties": false
    },
    "strict": true
  }
};

module.exports = {
  CATEGORIZE_MEMORY_SYSTEM,
  CATEGORIZE_MEMORY_USER,
  RETRIEVE_MEMORY_SYSTEM,
  RETRIEVE_MEMORY_USER,
  CATEGORIZE_SCHEMA
};

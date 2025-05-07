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
const RETRIEVE_MEMORY_SYSTEM = `You are a memory retrieval assistant. Find the most relevant memories to answer the question.

You will be provided with the entire memory database content. Your job is to scan through it and identify any information that would be relevant to answering the user's question.

Pay special attention to:
1. User preferences and default behaviors
2. Content with context attributes that match the query topic
3. Any information that directly relates to the query keywords
4. Location preferences or other user-specific settings`;

const RETRIEVE_MEMORY_USER = `Given the following memory database content and a question, extract and return only the information that is most relevant to answering the question.
    
Question: "{{question}}"
    
Memory Database Content:
{{memories}}

Important guidelines:
1. Search for keywords related to the question throughout the entire memory content
2. User preferences and default behaviors are CRITICAL to include
3. Pay special attention to memory entries with context attributes that match the query topic
4. Return the exact relevant text from the memory database - be precise and complete
5. If you find multiple relevant pieces of information, include all of them
6. Always check for default preferences related to the query topic`;

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

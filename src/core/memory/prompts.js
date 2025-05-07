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

// Prompt for consolidating long-term memory
const CONSOLIDATE_MEMORY_SYSTEM = `You are a memory optimization assistant. Your task is to carefully consolidate a set of memories by:
1. Removing exact and near-duplicate memories (keeping the newest version based on timestamp)
2. Pruning low-value content like process markers, debugging info, and metadata that won't be useful for future queries
3. Merging memories that convey the same material facts or understanding about the SAME SPECIFIC TOPIC, even if the wording is different
4. Being careful NOT to combine conceptually distinct memories, even if they're in the same general category
5. NEVER combining different types of user preferences (e.g., preferences about response style should be separate from preferences about weather)
6. Only consolidating multiple memories into a "model of understanding" when they are about the EXACT SAME TOPIC
7. Adding relevant tags/categorizations to each consolidated memory to improve retrieval
8. Preserving all substantive information that would be valuable for future retrieval

You must respond with a JSON object containing an array of consolidated memory objects.`;

const CONSOLIDATE_MEMORY_USER = `Analyze and consolidate the following memories:

{{memories}}

For each memory or group of related memories:
1. Remove metadata like "[ReflectionMarker]", timestamps, and process indicators that don't provide substantive value
2. Identify duplicates or near-duplicates and keep only the newest version (based on timestamp)
3. Be aggressive in consolidation ONLY when memories are about the SAME SPECIFIC TOPIC - if two memories convey the same material facts or understanding about a specific topic, they should be combined
4. Test memories or example memories with no practical value should be consolidated into a single entry
5. If memories are just variations of the same concept (like "This is a test memory" and "Another test memory"), combine them into one
6. DO NOT combine conceptually distinct memories even if they are in the same general category (e.g., do not combine user preferences for conciseness with user preferences for weather)
7. Only consolidate multiple memories into a "model of understanding" when they are about the EXACT SAME TOPIC
8. Add 3-5 relevant tags to each consolidated memory to improve retrieval (comma-separated)
9. Preserve the module and timestamp attributes from the newest memory in each group

Return a JSON object with a 'memories' array containing the consolidated memory objects:
{
  "memories": [
    {
      "module": "string", // Original module or category
      "timestamp": number, // Unix timestamp from the newest memory in each group (no quotes)
      "content": "string", // The consolidated, cleaned content
      "tags": "string" // Comma-separated list of 3-5 relevant tags for this memory
    }
  ]
}`;

// JSON schema for consolidation response
const CONSOLIDATE_SCHEMA = {
  "type": "json_schema",
  "json_schema": {
    "name": "consolidation",
    "schema": {
      "type": "object",
      "properties": {
        "memories": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "module": {
                "type": "string",
                "description": "The module or category of the memory"
              },
              "timestamp": {
                "type": "number",
                "description": "The Unix timestamp of the memory (use the newest timestamp when consolidating)"
              },
              "content": {
                "type": "string",
                "description": "The consolidated memory content, cleaned of low-value metadata"
              },
              "tags": {
                "type": "string",
                "description": "Comma-separated list of 3-5 relevant tags for this memory"
              }
            },
            "required": ["module", "timestamp", "content", "tags"],
            "additionalProperties": false
          }
        }
      },
      "required": ["memories"],
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
  CATEGORIZE_SCHEMA,
  CONSOLIDATE_MEMORY_SYSTEM,
  CONSOLIDATE_MEMORY_USER,
  CONSOLIDATE_SCHEMA
};

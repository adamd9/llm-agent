/**
 * Prompts used by the Memory module
 * 
 * Template variables:
 * - {{question}}: The question or query for memory retrieval (for RETRIEVE_MEMORY_USER)
 * - {{memories}}: The list of memories to search through (for RETRIEVE_MEMORY_USER)
 */

const { loadPrompt } = require('../../utils/promptManager');
const MODULE = 'memory';



// Prompt for retrieving relevant memories
const RETRIEVE_MEMORY_SYSTEM_DEFAULT = `You are a memory retrieval assistant. Find the most relevant memories to answer the question.

You will be provided with the entire memory database content organized in markdown format. Your job is to scan through it and identify any information that would be relevant to answering the user's question.

Memories are formatted as markdown entries with headings and metadata, like this:
## Memory: [context]
*Module: [module] | Timestamp: [timestamp] | Tags: [tags]*

[content]

---

Pay special attention to:
1. User preferences and default behaviors - these are CRITICAL to include
2. Content with context attributes that match the query topic
3. Any information that directly relates to the query keywords
4. Location preferences, formatting preferences, or other user-specific settings
5. Tags in the memory entries that relate to the query topic (e.g., 'weather', 'temperature', etc.)
6. Implicit relationships between the query and stored memories (e.g., if query is about weather, look for location preferences)`;
const RETRIEVE_MEMORY_SYSTEM = loadPrompt(MODULE, 'RETRIEVE_MEMORY_SYSTEM', RETRIEVE_MEMORY_SYSTEM_DEFAULT);

const RETRIEVE_MEMORY_USER_DEFAULT = `Given the following memory database content and a question, extract and return only the information that is most relevant to answering the question.
    
Question: "{{question}}"
    
Memory Database Content (in markdown format):
{{memories}}

Important guidelines:
1. Search for keywords related to the question throughout the entire memory content
2. User preferences and default behaviors are CRITICAL to include
3. Pay special attention to memory entries with context attributes in their headings or metadata
4. Examine memory tags in the metadata for relevance to the query (e.g., tags like 'weather', 'temperature', 'location')
5. Return the exact relevant text from the memory database - be precise and complete
6. If you find multiple relevant pieces of information, include all of them
7. Always check for default preferences related to the query topic
8. Consider implicit relationships (e.g., weather queries need location preferences)
9. Be thorough - missing relevant information will impact the quality of responses`;
const RETRIEVE_MEMORY_USER = loadPrompt(MODULE, 'RETRIEVE_MEMORY_USER', RETRIEVE_MEMORY_USER_DEFAULT);



// Prompt for consolidating long-term memory
const CONSOLIDATE_MEMORY_SYSTEM_DEFAULT = `You are a memory optimization assistant. Your task is to carefully consolidate a set of memories formatted in markdown by:
1. Removing exact and near-duplicate memories (keeping the newest version based on timestamp)
2. Pruning low-value content like process markers, debugging info, and metadata that won't be useful for future queries
3. Merging memories that convey the same material facts or understanding about the SAME SPECIFIC TOPIC, even if the wording is different
4. Being careful NOT to combine conceptually distinct memories, even if they're in the same general category
5. NEVER combining different types of user preferences (e.g., preferences about response style should be separate from preferences about weather)
6. Only consolidating multiple memories into a "model of understanding" when they are about the EXACT SAME TOPIC
7. Adding relevant tags/categorizations to each consolidated memory to improve retrieval
8. Preserving all substantive information that would be valuable for future retrieval

Memories are formatted as markdown entries with headings and metadata, like this:
## Memory: [context]
*Module: [module] | Timestamp: [timestamp] | Tags: [tags]*

[content]

---

You must respond with a JSON object containing an array of consolidated memory objects.`;
const CONSOLIDATE_MEMORY_SYSTEM = loadPrompt(MODULE, 'CONSOLIDATE_MEMORY_SYSTEM', CONSOLIDATE_MEMORY_SYSTEM_DEFAULT);

const CONSOLIDATE_MEMORY_USER_DEFAULT = `Analyze and consolidate the following memories, which are formatted in markdown:

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
10. Extract context from the memory headings (after '## Memory:') if available

Return a JSON object with a 'memories' array containing the consolidated memory objects:
{
  "memories": [
    {
      "module": "string", // Original module or category
      "timestamp": number, // Unix timestamp from the newest memory in each group (no quotes)
      "content": "string", // The consolidated, cleaned content
      "tags": "string", // Comma-separated list of 3-5 relevant tags for this memory
      "context": "string" // Original context from the memory heading if available
    }
  ]
}`;
const CONSOLIDATE_MEMORY_USER = loadPrompt(MODULE, 'CONSOLIDATE_MEMORY_USER', CONSOLIDATE_MEMORY_USER_DEFAULT);

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
              },
              "context": {
                "type": "string",
                "description": "The context or title of the memory from the memory heading"
              }
            },
            "required": ["module", "timestamp", "content", "tags", "context"],
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

// Prompts for summarizing short-term memory before long-term storage
// The transcript may contain debug logs, tool traces or other noisy system output.
// The assistant should distill the true conversation and important facts while ignoring
// low level debug chatter.
const SHORT_TERM_SUMMARY_SYSTEM_DEFAULT = `You are a memory summarization assistant. Condense a conversation transcript into a concise summary capturing the key user requests, assistant responses, decisions and outcomes. Ignore debug logs or repetitive tool traces.`;
const SHORT_TERM_SUMMARY_USER_DEFAULT = `Summarize the following conversation transcript. Omit filler text, debug statements and irrelevant tool output. Capture any key facts, decisions or results in bullet form. Use as many bullets as needed to cover all important information.\n\n{{transcript}}`;
const SHORT_TERM_SUMMARY_SYSTEM = loadPrompt(MODULE, 'SHORT_TERM_SUMMARY_SYSTEM', SHORT_TERM_SUMMARY_SYSTEM_DEFAULT);
const SHORT_TERM_SUMMARY_USER = loadPrompt(MODULE, 'SHORT_TERM_SUMMARY_USER', SHORT_TERM_SUMMARY_USER_DEFAULT);

module.exports = {
  RETRIEVE_MEMORY_SYSTEM,
  RETRIEVE_MEMORY_USER,
  CONSOLIDATE_MEMORY_SYSTEM,
  CONSOLIDATE_MEMORY_USER,
  CONSOLIDATE_SCHEMA,
  SHORT_TERM_SUMMARY_SYSTEM,
  SHORT_TERM_SUMMARY_USER
};

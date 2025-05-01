const fs = require("fs");
const path = require("path");
const { getOpenAIClient } = require("./utils/openaiClient.js");
const logger = require("./utils/logger.js");

// Define the path for storing memory files
const baseMemoryPath = path.resolve(__dirname, "../data/memory");
const shortTermPath = path.join(baseMemoryPath, "short");
const longTermPath = path.join(baseMemoryPath, "long");
const maxLines = 200; // Adjust this as necessary

// Define constants for file names
const SHORT_TERM_FILE = 'short_term.txt';
const LONG_TERM_FILE = 'long_term.txt';

// Ensure all memory directories exist
if (!fs.existsSync(baseMemoryPath)) fs.mkdirSync(baseMemoryPath);
if (!fs.existsSync(shortTermPath)) fs.mkdirSync(shortTermPath);
if (!fs.existsSync(longTermPath)) fs.mkdirSync(longTermPath);

class Memory {
  constructor() {
    this.openaiClient = getOpenAIClient();
  }

  // Reset memory by clearing short-term memory
  async resetMemory() {
    logger.debug('Memory', 'Resetting short-term memory');
    try {
      const shortTermFile = path.join(shortTermPath, SHORT_TERM_FILE);

      // Clear the short term file
      if (fs.existsSync(shortTermFile)) {
        fs.writeFileSync(shortTermFile, '');
        logger.debug('Memory', 'Short-term memory cleared');
      }
    } catch (error) {
      logger.error('Memory', 'Error resetting memory:', { error: error.message });
      throw error;
    }
  }

  // Store short term memory
  async storeShortTerm(context, data, module = 'ego') {
    logger.debug('Memory', 'Storing short-term memory', { context, data, module });
    const filePath = path.join(shortTermPath, SHORT_TERM_FILE);
    const timestamp = Math.floor(Date.now() / 1000);

    // Convert data to string if it's not already
    let dataString;
    if (typeof data === 'string') {
      dataString = data;
    } else {
      try {
        dataString = JSON.stringify(data);
      } catch (err) {
        logger.error('Memory', 'Failed to serialize data', { error: err.message });
        return;
      }
    }

    // Format and append the memory entry
    const memoryEntry = `[${module}][${context}][${timestamp}] ${dataString}\n`;
    try {
      fs.appendFileSync(filePath, memoryEntry);
      logger.debug('Memory', 'Stored short-term memory successfully');
    } catch (error) {
      logger.error('Memory', 'Error storing short-term memory', { error: error.message });
      throw error;
    }
  }

  // Retrieve short term memory
  retrieveShortTerm() {
    const filePath = path.join(shortTermPath, SHORT_TERM_FILE);
    if (fs.existsSync(filePath)) {
      const memContent = fs.readFileSync(filePath, 'utf-8');
      return memContent;
    } else {
      return null;
    }
  }

  // Store long term memory
  async storeLongTerm(data) {
    logger.debug("Memory", "Storing long term memory", { data });
    const dataString = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    
    // Use LLM to categorize data
    const userPrompt = `Categorize the following data into a one-word description. Unless there is an explicit category, categorize it as one of the following: 
        - ego (conversation style preferences, user preferences) This is also the default category
        - execution (skills / tool usage)
        - planning (how to structure plans)
        - evaluation (how to evaluate plans)
        If it doesn't fit, suggest a unique, single word category: ${dataString}`;

    try {
      const messages = [
        { role: "system", content: "You are a categorization assistant. You must respond with valid JSON." },
        { role: "user", content: userPrompt },
      ];
      const response = await this.openaiClient.chat(messages, {
        response_format: {
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
        },
        temperature: 0.7,
        max_tokens: 10
      });
      const category = JSON.parse(response.content).category.name.trim();
      logger.debug("Memory", "Categorized long term memory", { dataString, category });

      const filePath = path.join(longTermPath, LONG_TERM_FILE);
      const timestamp = Math.floor(Date.now() / 1000);
      fs.appendFileSync(filePath, `[${category}][${timestamp}] ${dataString}\n`);
      return {
        status: "success",
        data: dataString,
        category: category
      }
    } catch (error) {
      logger.debug("Memory", "Error categorizing long term memory", {
        error: {
          message: error.message,
          stack: error.stack,
        },
      });
      throw error;
    }
  }

  // Retrieve long term memory by context
  async retrieveLongTerm(context = "ego", question) {
    if (context == null) {
      context = "ego";
    }
    logger.debug("Memory", "Retrieving long term memory for question", { context, question });
    
    const filePath = path.join(longTermPath, LONG_TERM_FILE);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const memoryContent = fs.readFileSync(filePath, 'utf-8');
    const memories = memoryContent.split('\n').filter(line => line.trim() !== '');

    // Filter memories based on context and use LLM to find relevant ones
    const relevantMemories = memories.filter(memory => memory.includes(`[${context}]`));
    
    if (relevantMemories.length === 0) {
      return null;
    }

    // Use LLM to find the most relevant memories for the question
    const prompt = `Given the following memories and a question, determine which memories are most relevant to answering the question.
    
    Question: "${question}"
    
    Memories:
    ${relevantMemories.join('\n')}`;

    try {
      const messages = [
        {
          role: "system",
          content: "You are a memory retrieval assistant. Find the most relevant memories to answer the question."
        },
        { role: "user", content: prompt }
      ];

      const response = await this.openaiClient.chat(messages);
      return {
        status: "success",
        analysis: response.content
      };
    } catch (error) {
      logger.error("Memory", "Error retrieving long term memory", {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = new Memory();

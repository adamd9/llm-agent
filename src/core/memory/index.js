const fs = require("fs");
const path = require("path");
const { getOpenAIClient } = require("../../utils/openaiClient.js");
const logger = require("../../utils/logger.js");
const prompts = require("./prompts");

// Define the path for storing memory files
const baseMemoryPath = path.resolve(__dirname, "../../../data/memory");
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
    const userPrompt = prompts.CATEGORIZE_MEMORY_USER.replace('{{data}}', dataString);

    try {
      const messages = [
        { role: "system", content: prompts.CATEGORIZE_MEMORY_SYSTEM },
        { role: "user", content: userPrompt },
      ];
      const response = await this.openaiClient.chat(messages, {
        response_format: prompts.CATEGORIZE_SCHEMA,
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
    const prompt = prompts.RETRIEVE_MEMORY_USER
      .replace('{{question}}', question)
      .replace('{{memories}}', relevantMemories.join('\n'));

    try {
      const messages = [
        { role: "system", content: prompts.RETRIEVE_MEMORY_SYSTEM },
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

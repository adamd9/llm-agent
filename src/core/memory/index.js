const fs = require("fs");
const path = require('path');
const { DATA_DIR_PATH } = require('../../utils/dataDir');
const { getOpenAIClient } = require("../../utils/openaiClient.js");
const { loadSettings } = require('../../utils/settings');
const logger = require("../../utils/logger.js");
const prompts = require("./prompts");
const sharedEventEmitter = require("../../utils/eventEmitter");

// Define the path for storing memory files
const baseMemoryPath = path.join(DATA_DIR_PATH, 'memory');
const shortTermPath = path.join(baseMemoryPath, "short");
const longTermPath = path.join(baseMemoryPath, "long");
const maxLines = 200; // Adjust this as necessary

// Define constants for file names
const SHORT_TERM_FILE = 'short_term.txt';
const LONG_TERM_FILE = 'long_term.txt';

// Define memory delimiters for multi-line content in markdown format
const MEMORY_START_TAG = '```memory';
const MEMORY_END_TAG = '```';

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

    try {
      // Use markdown format for more human readability
      const memoryEntry = `
## Memory: ${context}

*Module: ${module} | Timestamp: ${timestamp}*

${dataString}

---
`;
      
      // No subsystem events for storage operations - we only care about retrieval results
      fs.appendFileSync(filePath, memoryEntry);
      
      logger.debug('Memory', 'Stored short-term memory successfully');
      return { status: 'success' };
    } catch (error) {
      // No subsystem events for storage errors - we only care about retrieval results
      logger.error('Memory', 'Error storing short-term memory', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Retrieve short term memory
  async retrieveShortTerm() {
    logger.debug('Memory', 'Retrieving short-term memory');
    const filePath = path.join(shortTermPath, SHORT_TERM_FILE);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const memoryContent = fs.readFileSync(filePath, 'utf-8');
    
    // Emit subsystem message with the actual short-term memory content
    await sharedEventEmitter.emit('subsystemMessage', {
      module: 'memory',
      content: {
        type: 'memory_retrieval_result',
        memoryType: 'short-term',
        result: memoryContent,
        timestamp: new Date().toISOString()
      }
    });
    
    return memoryContent;
  }

  // Store long term memory
  async storeLongTerm(data) {
    logger.debug("Memory", "Storing long term memory", { data });
    const dataString = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    
    // No subsystem events for storage operations - we only care about retrieval results
    
    try {
      const filePath = path.join(longTermPath, LONG_TERM_FILE);
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Use markdown format for long-term memory
      const memoryEntry = `
## Long-Term Memory

*Timestamp: ${timestamp}*

${dataString}

---
`;
      fs.appendFileSync(filePath, memoryEntry);
      
      // No subsystem events for successful storage - we only care about retrieval results
      
      return {
        status: "success",
        data: dataString
      }
    } catch (error) {
      // No subsystem events for storage errors - we only care about retrieval results
      logger.debug("Memory", "Error storing long term memory", {
        error: {
          message: error.message,
          stack: error.stack,
        },
      });
      throw error;
    }
  }

  // Rotate long term memory file to create a backup before consolidation
  async rotateLongTermFile() {
    logger.debug("Memory", "Rotating long term memory file");
    const filePath = path.join(longTermPath, LONG_TERM_FILE);
    
    if (!fs.existsSync(filePath)) {
      logger.debug("Memory", "No long term memory file to rotate");
      return false;
    }
    
    try {
      // Create a timestamp for the backup file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(longTermPath, `long_term_${timestamp}.bak`);
      
      // Copy the current file to the backup
      fs.copyFileSync(filePath, backupPath);
      logger.debug("Memory", "Created backup of long term memory", { backupPath });
      
      return backupPath;
    } catch (error) {
      logger.error("Memory", "Error rotating long term memory file", {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Consolidate long term memory using LLM to remove duplicates, prune low-value content, and merge similar memories
  async consolidateLongTerm(bypassTokenLimit = false) {
    logger.debug("Memory", "Consolidating long term memory using LLM");
    const filePath = path.join(longTermPath, LONG_TERM_FILE);
    
    if (!fs.existsSync(filePath)) {
      logger.debug("Memory", "No long term memory file to consolidate");
      return { status: "success", message: "No memory file to consolidate", consolidated: 0 };
    }
    
    try {
      // First, create a backup of the current file
      const backupPath = await this.rotateLongTermFile();
      
      // Read the memory content
      const memoryContent = fs.readFileSync(filePath, 'utf-8');
      
      if (!memoryContent || memoryContent.trim() === '') {
        return { status: "success", message: "Memory file is empty", consolidated: 0 };
      }
      
      // We no longer attempt to parse – just send raw content.
      const originalSize = memoryContent.length;
      logger.debug("Memory", "Using LLM to consolidate raw memory content", { originalSize });

      // Wrap raw memories in fenced markdown block so the LLM sees clear boundaries.
      const formattedMemories = `\n\n\`\`\`markdown\n${memoryContent}\n\`\`\``;
      
      // Use LLM to consolidate memories
      const userPrompt = prompts.CONSOLIDATE_MEMORY_USER.replace('{{memories}}', formattedMemories);
      
      // Emit subsystem message about starting the consolidation
      await sharedEventEmitter.emit('subsystemMessage', {
        module: 'memory',
        content: {
          type: 'memory_consolidation_start',
          originalSize,
          timestamp: new Date().toISOString()
        }
      });
      
      const messages = [
        { role: "system", content: prompts.CONSOLIDATE_MEMORY_SYSTEM },
        { role: "user", content: userPrompt }
      ];
      
      const response = await this.openaiClient.chat(messages, {
        response_format: prompts.CONSOLIDATE_SCHEMA,
        temperature: 0.2,
        max_tokens: 10000,
        bypassTokenLimit: bypassTokenLimit
      });
      
      // Parse the consolidated memories from the LLM response
      let consolidatedMemories;
      try {
        const parsedResponse = JSON.parse(response.content);
        if (!parsedResponse.memories || !Array.isArray(parsedResponse.memories)) {
          throw new Error('Response does not contain a memories array');
        }
        consolidatedMemories = parsedResponse.memories;
        logger.debug("Memory", "Successfully parsed consolidated memories", { count: consolidatedMemories.length });
      } catch (parseError) {
        logger.error("Memory", "Error parsing LLM response for memory consolidation", {
          error: parseError.message,
          response: response.content
        });
        throw new Error(`Failed to parse LLM response: ${parseError.message}`);
      }
      
      // Convert the consolidated memories back to the proper format
      let consolidatedContent = '';
      for (const memory of consolidatedMemories) {
        // Skip empty or invalid memories
        if (!memory.content || memory.content.trim() === '') {
          continue;
        }
        
        // Use markdown format with tags attribute
        consolidatedContent += `
## Memory: ${memory.context || 'Consolidated'}

*Module: ${memory.module || 'system'} | Timestamp: ${memory.timestamp} | Tags: ${memory.tags || ''}*

${memory.content}

---
`;
      }
      
      // Write the consolidated content back to the file
      fs.writeFileSync(filePath, consolidatedContent);
      
      // Size metrics
      const consolidatedCount = consolidatedMemories.length;
      const consolidatedSize = consolidatedContent.length;
      const sizeReduction = originalSize - consolidatedSize;
      
      logger.debug("Memory", "Long term memory consolidated using LLM", {
        originalSize,
        consolidatedSize,
        sizeReduction,
        consolidatedCount
      });
      
      // Emit subsystem message about the consolidation
      await sharedEventEmitter.emit('subsystemMessage', {
        module: 'memory',
        content: {
          type: 'memory_consolidation_result',
          originalSize,
          consolidatedSize,
          sizeReduction,
          consolidatedCount,
          backupPath,
          timestamp: new Date().toISOString()
        }
      });
      
      return {
        status: "success",
        message: "Long term memory consolidated successfully using LLM",
        originalSize,
        consolidatedSize,
        sizeReduction,
        consolidatedCount,
        backupPath
      };
    } catch (error) {
      logger.error("Memory", "Error consolidating long term memory", {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Retrieve long term memory by context
  async retrieveLongTerm(context = "ego", question, shortTermMemory = '') {
    if (context == null) {
      context = "ego";
    }
    logger.debug("Memory", "Retrieving long term memory for question", { context, question, shortTermMemoryIncluded: shortTermMemory && shortTermMemory.length });
    
    const filePath = path.join(longTermPath, LONG_TERM_FILE);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    // Read the entire memory content without parsing
    const memoryContent = fs.readFileSync(filePath, 'utf-8');
    
    if (!memoryContent || memoryContent.trim() === '') {
      return null;
    }
    
    // No parsing, no filtering - just use the raw memory content
    const formattedMemories = memoryContent;

    // Use LLM to find the most relevant memories for the question
    let queryWithContext = question;
    if (shortTermMemory && typeof shortTermMemory === 'string' && shortTermMemory.trim() !== '') {
      queryWithContext += `\nConversation context:\n${shortTermMemory}`;
    }

    const prompt = prompts.RETRIEVE_MEMORY_USER
      .replace('{{question}}', queryWithContext)
      .replace('{{memories}}', formattedMemories);

    try {
      const messages = [
        { role: "system", content: prompts.RETRIEVE_MEMORY_SYSTEM },
        { role: "user", content: prompt }
      ];


      const response = await this.openaiClient.chat(messages);
      
      // Emit subsystem message with the actual retrieval results
      await sharedEventEmitter.emit('subsystemMessage', {
        module: 'memory',
        content: {
          type: 'memory_retrieval_result',
          memoryType: 'long-term',
          result: response.content,
          context,
          question: queryWithContext,
          timestamp: new Date().toISOString()
        }
      });
      
      // Return just the analysis content, not an object
      return response.content;
    } catch (error) {
      logger.error("Memory", "Error retrieving long term memory", {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Read raw short term memory file
  getShortTermMemory() {
    const filePath = path.join(shortTermPath, SHORT_TERM_FILE);
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  // Read raw long term memory file
  getLongTermMemory() {
    const filePath = path.join(longTermPath, LONG_TERM_FILE);
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  // Move short term memory into long term storage and clear short term file
  async consolidateShortTermToLongTerm() {
    try {
      const shortContent = this.getShortTermMemory();
      if (!shortContent.trim()) return;
      // Generate a concise summary of the short-term transcript using the LLM.
      // The summary should capture key facts and results while skipping debug
      // or tool noise that may be present in the transcript.
      let summary = '';
      try {
        const messages = [
          { role: 'system', content: prompts.SHORT_TERM_SUMMARY_SYSTEM },
          { role: 'user', content: prompts.SHORT_TERM_SUMMARY_USER.replace('{{transcript}}', shortContent) }
        ];
        const settings = loadSettings();
        const response = await this.openaiClient.chat(messages, {
          model: settings.memoryModel || settings.llmModel
        });
        summary = response.content;
      } catch (summErr) {
        logger.error('Memory', 'Error summarizing short term memory', { error: summErr.message });
        summary = shortContent; // Fallback to raw content if summarization fails
      }

      await this.storeLongTerm(`[Conversation Summary] ${summary}`);
      await this.resetMemory();
    } catch (err) {
      logger.error('Memory', 'Failed to consolidate short term memory', { error: err.message });
    }
  }
}

module.exports = new Memory();

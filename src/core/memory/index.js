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

  // Parse memory content with markdown format and handle consolidated tags for backward compatibility
  parseMemoryContent(content) {
    const memories = [];
    
    // New markdown format
    // Match markdown memories in the format: ## Memory: <context>\n*Module: <module> | Timestamp: <timestamp>*\n\n<content>\n\n---
    const markdownRegex = /## Memory: ([^\n]*)\s*\n\s*\*Module: ([^|]*) \| Timestamp: ([^\*]*)\*\s*\n\n([\s\S]*?)\n\n---/g;
    
    let match;
    while ((match = markdownRegex.exec(content)) !== null) {
      try {
        memories.push({
          context: match[1].trim(),
          module: match[2].trim(),
          timestamp: match[3].trim(),
          content: match[4].trim(),
          format: 'markdown'
        });
      } catch (error) {
        logger.error('Memory', 'Error parsing markdown memory content', { error: error.message });
      }
    }
    
    // Handle consolidated tag format for backward compatibility 
    const memoryRegex = /<MEMORY\s+([^>]+)>\n([\s\S]*?)\n<\/MEMORY>/g;
    
    while ((match = memoryRegex.exec(content)) !== null) {
      try {
        // Parse attributes from the tag
        const attributesStr = match[1];
        const attributes = {};
        
        // Extract attributes using regex
        const attrRegex = /(\w+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
          attributes[attrMatch[1]] = attrMatch[2];
        }
        
        // Create memory object with parsed attributes
        // If tags attribute is missing, add an empty one for backward compatibility
        if (!attributes.tags) {
          attributes.tags = '';
        }
        
        memories.push({
          ...attributes,
          content: match[2],
          format: 'consolidated'
        });
      } catch (error) {
        logger.error('Memory', 'Error parsing memory content', { error: error.message });
      }
    }
    
    // Also handle older legacy format for backward compatibility
    // This can be removed once all memory files are migrated
    this.parseLegacyMemoryContent(content, memories);
    
    return memories;
  }
  
  // Parse legacy memory content for backward compatibility
  parseLegacyMemoryContent(content, memories) {
    // Legacy format with old delimiters
    const legacyShortTermRegex = /\[(.*?)\]\[(.*?)\]\[(.*?)\]\n<MEMORY_CONTENT>\n([\s\S]*?)\n<\/MEMORY_CONTENT>/g;
    const legacyLongTermRegex = /\[(.*?)\]\[(.*?)\]\n<MEMORY_CONTENT>\n([\s\S]*?)\n<\/MEMORY_CONTENT>/g;
    
    // Process short-term legacy format
    let match;
    while ((match = legacyShortTermRegex.exec(content)) !== null) {
      memories.push({
        module: match[1],
        context: match[2],
        timestamp: match[3],
        content: match[4],
        format: 'legacy_delimited'
      });
    }
    
    // Process long-term legacy format
    const processedRanges = [];
    while ((match = legacyLongTermRegex.exec(content)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      
      // Skip if this range overlaps with a previously processed range
      const overlaps = processedRanges.some(range => 
        (matchStart >= range.start && matchStart <= range.end) || 
        (matchEnd >= range.start && matchEnd <= range.end)
      );
      
      if (!overlaps && match[0].indexOf('][') === match[0].lastIndexOf('][')) {
        memories.push({
          module: match[1],
          timestamp: match[2],
          content: match[3],
          format: 'legacy_delimited'
        });
        
        processedRanges.push({
          start: matchStart,
          end: matchEnd
        });
      }
    }
    
    // Legacy format without delimiters (oldest format)
    const legacyOldestRegex = /\[(.*?)\]\[(.*?)\]\[(.*?)\]\s([\s\S]*?)(?=\n\[|\n$)/g;
    while ((match = legacyOldestRegex.exec(content)) !== null) {
      // Skip if this is already captured by other formats
      const isDuplicate = memories.some(m => 
        m.timestamp === match[3] && m.content.includes(match[4].trim())
      );
      
      if (!isDuplicate) {
        memories.push({
          module: match[1],
          context: match[2],
          timestamp: match[3],
          content: match[4].trim(),
          format: 'legacy_oldest'
        });
      }
    }
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
      
      // Parse the memory content to get individual memories
      const memories = this.parseMemoryContent(memoryContent);
      
      if (memories.length === 0) {
        return { status: "success", message: "No memories found to consolidate", consolidated: 0 };
      }
      
      logger.debug("Memory", "Using LLM to intelligently consolidate memories", { memoryCount: memories.length });
      
      // Prepare the memories in markdown format that's easy for the LLM to analyze
      const formattedMemories = memories.map(memory => {
        const memoryContext = memory.context || 'Memory';
        const memoryModule = memory.module || 'system';
        return `## Memory: ${memoryContext}

*Module: ${memoryModule} | Timestamp: ${memory.timestamp}*

${memory.content}`;
      }).join('\n\n---\n\n');
      
      // Use LLM to consolidate memories
      const userPrompt = prompts.CONSOLIDATE_MEMORY_USER.replace('{{memories}}', formattedMemories);
      
      // Emit subsystem message about starting the consolidation
      await sharedEventEmitter.emit('subsystemMessage', {
        module: 'memory',
        content: {
          type: 'memory_consolidation_start',
          originalCount: memories.length,
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
      
      // Calculate how many memories were consolidated
      const consolidatedCount = consolidatedMemories.length;
      const removedCount = memories.length - consolidatedCount;
      
      logger.debug("Memory", "Long term memory consolidated using LLM", {
        original: memories.length,
        consolidated: consolidatedCount,
        removed: removedCount
      });
      
      // Emit subsystem message about the consolidation
      await sharedEventEmitter.emit('subsystemMessage', {
        module: 'memory',
        content: {
          type: 'memory_consolidation_result',
          originalCount: memories.length,
          consolidatedCount: consolidatedCount,
          removedCount: removedCount,
          backupPath,
          timestamp: new Date().toISOString()
        }
      });
      
      return {
        status: "success",
        message: "Long term memory consolidated successfully using LLM",
        originalCount: memories.length,
        consolidatedCount: consolidatedCount,
        removedCount: removedCount,
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

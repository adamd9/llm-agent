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

// Define memory delimiters for multi-line content
const MEMORY_START_TAG = '<MEMORY';
const MEMORY_END_TAG = '</MEMORY>';

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

    // Format and append the memory entry with consolidated tags
    const memoryEntry = `<MEMORY module="${module}" context="${context}" timestamp="${timestamp}">
${dataString}
</MEMORY>
`;
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

  // Parse memory content with consolidated tags
  parseMemoryContent(content) {
    const memories = [];
    
    // New consolidated tag format
    const memoryRegex = /<MEMORY\s+([^>]+)>\n([\s\S]*?)\n<\/MEMORY>/g;
    
    let match;
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
        memories.push({
          ...attributes,
          content: match[2],
          format: 'consolidated'
        });
      } catch (error) {
        logger.error('Memory', 'Error parsing memory content', { error: error.message });
      }
    }
    
    // Also handle legacy format for backward compatibility
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
      
      // Use consolidated tag format
      fs.appendFileSync(filePath, `<MEMORY module="${category}" timestamp="${timestamp}">
${dataString}
</MEMORY>
`);
      
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
    
    // Parse memories using the consolidated tag approach
    const memories = this.parseMemoryContent(memoryContent);
    
    // Filter memories based on context
    const relevantMemories = memories.filter(memory => memory.module === context);
    
    if (relevantMemories.length === 0) {
      return null;
    }

    // Format memories for the LLM prompt
    const formattedMemories = relevantMemories.map(memory => {
      if (memory.format === 'consolidated') {
        return `<MEMORY module="${memory.module}" timestamp="${memory.timestamp}">
${memory.content}
</MEMORY>`;
      } else {
        // Handle legacy formats for backward compatibility
        return `<MEMORY module="${memory.module}" timestamp="${memory.timestamp}">
${memory.content}
</MEMORY>`;
      }
    });

    // Use LLM to find the most relevant memories for the question
    const prompt = prompts.RETRIEVE_MEMORY_USER
      .replace('{{question}}', question)
      .replace('{{memories}}', formattedMemories.join('\n\n'));

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

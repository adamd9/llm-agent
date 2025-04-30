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
const LONG_TERM_FILE = 'for_long_term.txt';
const CURRENT_FILE = 'current.txt';
// Ensure all memory directories exist
if (!fs.existsSync(baseMemoryPath)) fs.mkdirSync(baseMemoryPath);
if (!fs.existsSync(shortTermPath)) fs.mkdirSync(shortTermPath);
if (!fs.existsSync(longTermPath)) fs.mkdirSync(longTermPath);

class Memory {
  constructor() {
    this.openaiClient = getOpenAIClient();
  }

  // Store short term memory
  async storeShortTerm(context, data, memStore = 'ego', overwrite = false) {
    logger.debug('Memory', 'Storing short-term memory', { context, data, memStore });
    const filePath = path.join(shortTermPath, `${memStore}_${CURRENT_FILE}`);
    const timestamp = Math.floor(Date.now() / 1000);
    let fileContent = '';

    // Check if the file exists
    if (fs.existsSync(filePath)) {
      fileContent = fs.readFileSync(filePath, 'utf-8');
    }

    const lines = fileContent.split('\n').filter(line => line.trim() !== '');

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

    const newLines = dataString.split('\n').filter(line => line.trim() !== '');
    const totalLines = lines.length + newLines.length;

    if (overwrite) {
      fs.writeFileSync(filePath, `[${context}][${timestamp}] ${dataString}\n`);
      return;
    } else if (totalLines > maxLines) {
      const linesToMove = totalLines - maxLines;
      const linesToRetain = lines.slice(linesToMove);

      // Move the oldest lines to the long term storage
      const longTermFilePath = path.join(shortTermPath, memStore + '_' + LONG_TERM_FILE);
      const linesToMoveContent = lines.slice(0, linesToMove).join('\n') + '\n';
      fs.appendFileSync(longTermFilePath, linesToMoveContent);

      // Retain only recent lines and add new data
      const updatedContent = linesToRetain.join('\n') + '\n' + newLines.join('\n') + '\n';
      fs.writeFileSync(filePath, `[${context}][${timestamp}] ${updatedContent}`);
    } else {
      // Append new data if within limits
      fs.appendFileSync(filePath, `[${context}][${timestamp}] ${dataString}\n`);
    }

    logger.debug('Memory', 'Stored short-term memory', { data: dataString }, false);
  }

  // Retrieve short term memory
  retrieveShortTerm(memStore = 'ego') {
    const filePath = path.join(shortTermPath, `${memStore}_${CURRENT_FILE}`);
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
    // Use LLM to categorize data into a subject
    const userPrompt = `Categorize the following data into a one-word description. Unless there is an explicit category, categorize it as one of the following: 
        - ego (conversation style preferences, user preferences) This is also the dedault category
        - execution (sklls / tool usage)
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

      const filePath = path.join(longTermPath, `${category}.txt`);
      fs.appendFileSync(filePath, `${dataString}\n`);
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

  // Retrieve long term memory by subject
  async retrieveLongTerm(context = "ego", question) {
    if (context == null) {
      context = "ego";
    }
    logger.debug("Memory", "Retrieving long term memory for question", { context, question });
    const subjects = fs.readdirSync(longTermPath).map((file) => path.basename(file, ".txt"));
    const initialPrompt = `Given the following list of subjects: ${subjects.join(
      ", "
    )}, determine which subjects contain information relevant to the question or query about "${context}".

    Not matter what, always include ${context} as a category.
    The question or query is: "${question}"`;

    try {
      // First LLM call to determine relevant subjects to check
      const messages = [
        {
          role: "system",
          content:
            "You are a component of an artificial long-term memory system. Your role is to intelligently categorize and determine relevant subjects in response to queries, enabling efficient retrieval of stored information. You must respond with valid JSON. Leverage your ability to analyze context and identify subject matter relevance accurately.",
        },
        { role: "user", content: initialPrompt },
      ];
      let completion = await this.openaiClient.chat(messages, {
        response_format: {
          "type": "json_schema",
          "json_schema": {
            "name": "evaluation",
            "schema": {
              "type": "object",
              "properties": {
                "categories": {
                  "type": "array",
                  "items": {
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
                }
              },
              "required": ["categories"],
              "additionalProperties": false
            },
            "strict": true
          }
        },
        temperature: 0.7,
        max_tokens: 100
      });

      logger.debug(
        "Memory",
        "Initial long-term memory retrieval OpenAI response",
        completion.content
      );

      // Retrieve relevant subjects from LLM response
      const relevantSubjects = JSON.parse(completion.content).categories;
      // Read content from relevant files
      let consolidatedContent = "";
      for (const subject of relevantSubjects) {
        const filePath = path.join(longTermPath, `${subject.name}.txt`);
        if (fs.existsSync(filePath)) {
          consolidatedContent += fs.readFileSync(filePath, "utf-8") + "\n";
        }
      }

      // Include content from the specific module context
      const contextPath = path.join(longTermPath, `${context}.txt`);
      if (fs.existsSync(contextPath)) {
        consolidatedContent = fs.readFileSync(contextPath, "utf-8") + "\n" + consolidatedContent;
      }

      logger.debug("Memory", "Consolidated long-term memory for question", { context, consolidatedContent });

      // Second LLM call to extract answer based on consolidated content
      const finalPrompt = `Using the following content retrieved from your long term memory banks, return any data relevant to the question or query.
      The ordering of content is important. Do not change the order of the content.
      If later lines appear to supercede earlier lines, make a note in brackets to indicate this, but otherwise return the content in the order it was provided to you.
      The question or query is: "${question}".\n\nTotal potential content:\n${consolidatedContent}`;
      const messages2 = [
        {
          role: "system",
          content:
            "You are an analog to a human's long term memory system. Your role is to intelligently retrieve information from your long term memory. You must respond with valid JSON. Leverage your ability to analyze context and identify subject matter relevance accurately.",
        },
        { role: "user", content: finalPrompt },
      ];
      completion = await this.openaiClient.chat(messages2, {
        temperature: 0.7,
        max_tokens: 1000,
        response_format: {
          "type": "json_schema",
          "json_schema": {
            "name": "memory_response",
            "schema": {
              "type": "object",
              "properties": {
                "response": {
                  "type": "string",
                  "description": "The retrieved memory content in order"
                }
              },
              "required": ["response"],
              "additionalProperties": false
            },
            "strict": true
          }
        }
      });

      const answer = JSON.parse(completion.content).response.trim();
      return answer;
    } catch (error) {
      logger.debug("Memory", "Error retrieving long-term memory", {
        error: {
          message: error.message,
          stack: error.stack,
        },
      });
      throw error;
    }
  }

  // Function to reset memory by moving contents from CURRENT_FILE to LONG_TERM_FILE
  async resetMemory() {
    const fs = require('fs').promises;
    const path = require('path');

    try {
      // List all files in the short term directory
      const files = await fs.readdir(shortTermPath);
      // Filter for files ending with _current.txt
      const currentFiles = files.filter(file => file.endsWith('_current.txt'));

      for (const currentFile of currentFiles) {
        const longTermFile = currentFile.replace('_current.txt', '_long_term.txt');
        // Read contents of the CURRENT_FILE
        const currentData = await fs.readFile(path.join(shortTermPath, currentFile), 'utf8');
        // Write contents to LONG_TERM_FILE
        await fs.appendFile(path.join(shortTermPath, longTermFile), currentData);
        // Clear CURRENT_FILE
        await fs.writeFile(path.join(shortTermPath, currentFile), '');
        logger.debug('Memory', `Memory reset successfully for ${currentFile}.`);
      }
    } catch (error) {
      logger.error('Memory', 'Error resetting memory:', { error: error.message });
    }
  }
}

module.exports = new Memory();

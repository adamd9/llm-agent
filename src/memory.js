const fs = require("fs");
const path = require("path");
const { getOpenAIClient } = require("./openaiClient.js");
const logger = require("./logger");

// Define the path for storing memory files
const baseMemoryPath = path.resolve(__dirname, "../data/memory");
const shortTermPath = path.join(baseMemoryPath, "short");
const longTermPath = path.join(baseMemoryPath, "long");
const maxLines = 200; // Adjust this as necessary

// Define constants for file names
const CURRENT_FILE = 'current.txt';
const LONG_TERM_FILE = 'for_long_term.txt';

// Ensure all memory directories exist
if (!fs.existsSync(baseMemoryPath)) fs.mkdirSync(baseMemoryPath);
if (!fs.existsSync(shortTermPath)) fs.mkdirSync(shortTermPath);
if (!fs.existsSync(longTermPath)) fs.mkdirSync(longTermPath);

class Memory {
  constructor() {
    this.openaiClient = getOpenAIClient();
  }

  // Store short term memory
  async storeShortTerm(context, data) {
    const filePath = path.join(shortTermPath, CURRENT_FILE);
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
  
    if (totalLines > maxLines) {
      const linesToMove = totalLines - maxLines;
      const linesToRetain = lines.slice(linesToMove);
  
      // Move the oldest lines to the long term storage
      const longTermFilePath = path.join(shortTermPath, LONG_TERM_FILE);
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
  retrieveShortTerm() {
    logger.debug('Memory', 'Retrieving short-term memory');
    const filePath = path.join(shortTermPath, CURRENT_FILE);
    if (fs.existsSync(filePath)) {
      const memContent = fs.readFileSync(filePath, 'utf-8');
      logger.debug('Memory', 'Short-term memory found', { memContent });
      return memContent;
    } else {
      return null;
    }
  }

  // Store long term memory
  async storeLongTerm(data) {
    // Use LLM to categorize data into a subject
    const userPrompt = `Categorize the following data into a one-word description related to these modules: 
        - ego (conversation style preferences, user preferences)
        - execution (tool usage)
        - planning (how to structure plans)
        - evaluation (how to evaluate plans)
        If it doesn't fit, suggest a unique, single word category: ${data}`;

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a categorization assistant." },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 10,
      });

      const category = response.choices[0].message.content.trim();
      logger.debug("Memory", "Categorized long term memory", { data, category });

      const filePath = path.join(longTermPath, `${category}.txt`);
      fs.appendFileSync(filePath, `${data}\n`);
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
  async retrieveLongTerm(context, question) {
    const subjects = fs.readdirSync(longTermPath).map((file) => path.basename(file, ".txt"));
    const initialPrompt = `Given the following list of subjects: ${subjects.join(
      ", "
    )}, determine which subjects contain information relevant to the question or query about "${context}".
    The question or query is: "${question}"`;

    try {
      // First LLM call to determine relevant subjects to check
      let completion = await this.openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a component of an artificial long-term memory system. Your role is to intelligently categorize and determine relevant subjects in response to queries, enabling efficient retrieval of stored information. Leverage your ability to analyze context and identify subject matter relevance accurately.",
          },
          { role: "user", content: initialPrompt },
        ],
        temperature: 0.7,
        max_tokens: 100,
      });

      // Retrieve relevant subjects from LLM response
      const relevantSubjects = completion.choices[0].message.content.split(",").map((subject) => subject.trim());

      // Read content from relevant files
      let consolidatedContent = "";
      for (const subject of relevantSubjects) {
        const filePath = path.join(longTermPath, `${subject}.txt`);
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
      const finalPrompt = `Using the following context retrieved from your long term memory banks based on subject matter, answer the question or return subject matter relevant to the provided query: "${question}".\n\nContext:\n${consolidatedContent}`;
      completion = await this.openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an advanced information retrieval assistant, operating within an artificial long-term memory framework. Your task is to synthesize and summarize context-specific information accurately to provide insightful and relevant answers to user queries, leveraging consolidated data.",
          },
          { role: "user", content: finalPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const answer = completion.choices[0].message.content.trim();
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

    try {
      // Read contents of CURRENT_FILE
      const currentData = await fs.readFile(path.join(shortTermPath, CURRENT_FILE), 'utf8');
      // Write contents to LONG_TERM_FILE
      await fs.writeFile(path.join(shortTermPath, LONG_TERM_FILE), currentData);
      // Clear CURRENT_FILE
      await fs.writeFile(path.join(shortTermPath, CURRENT_FILE), '');
      logger.debug('Memory', 'Memory reset successfully.');
    } catch (error) {
      logger.error('Memory', 'Error resetting memory:', { error: error.message });
    }
  }
}

module.exports = new Memory();

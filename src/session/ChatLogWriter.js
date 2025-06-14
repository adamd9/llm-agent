const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DATA_DIR_PATH } = require('../utils/dataDir');

class ChatLogWriter {
  constructor(options = {}) {
    this.logPath = options.chatLogPath || path.join(DATA_DIR_PATH, 'chat_history.ndjson');
    this.rotateMb = options.logRotateMb || 5;
    this.maxEntries = options.maxEntries || 100; // Default limit for history entries to load
    this.currentStream = fs.createWriteStream(this.logPath, { flags: 'a' });
  }

  _checkRotate() {
    const stats = fs.statSync(this.logPath);
    if (stats.size > this.rotateMb * 1024 * 1024) {
      const rotated = this.logPath.replace(/\.ndjson$/, `-${Date.now()}.ndjson`);
      fs.renameSync(this.logPath, rotated);
      this.currentStream = fs.createWriteStream(this.logPath, { flags: 'a' });
    }
  }

  append(entry) {
    try {
      this.currentStream.write(JSON.stringify(entry) + '\n');
      this._checkRotate();
    } catch (err) {
      console.error('Failed to write chat log', err);
    }
  }

  /**
   * Read chat history from the NDJSON file
   * @param {Object} options - Options for reading history
   * @param {number} options.limit - Maximum number of entries to read (default: this.maxEntries)
   * @param {Array<string>} options.roles - Only include entries with these roles (e.g., ['user', 'assistant'])
   * @returns {Promise<Array>} - Array of chat history entries
   */
  async readHistory(options = {}) {
    const limit = options.limit || this.maxEntries;
    const roles = options.roles || ['user', 'assistant']; // Default to only user and assistant messages
    
    // Check if file exists
    if (!fs.existsSync(this.logPath)) {
      return [];
    }
    
    return new Promise((resolve, reject) => {
      const history = [];
      const fileStream = fs.createReadStream(this.logPath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      rl.on('line', (line) => {
        try {
          if (line.trim()) {
            const entry = JSON.parse(line);
            // Only include entries with specified roles
            if (entry.role && roles.includes(entry.role)) {
              history.unshift(entry); // Add to beginning for reverse chronological order
              
              // Stop reading if we've reached the limit
              if (history.length >= limit) {
                rl.close();
                fileStream.close();
              }
            }
          }
        } catch (err) {
          console.error('Error parsing history line:', err);
          // Continue reading even if one line fails
        }
      });
      
      rl.on('close', () => {
        // Reverse the array to get chronological order
        resolve(history.reverse());
      });
      
      rl.on('error', (err) => {
        reject(err);
      });
    });
  }
}

module.exports = ChatLogWriter;

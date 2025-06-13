const fs = require('fs');
const path = require('path');
const { DATA_DIR_PATH } = require('../utils/dataDir');

class ChatLogWriter {
  constructor(options = {}) {
    this.logPath = options.chatLogPath || path.join(DATA_DIR_PATH, 'chat_history.ndjson');
    this.rotateMb = options.logRotateMb || 5;
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
}

module.exports = ChatLogWriter;

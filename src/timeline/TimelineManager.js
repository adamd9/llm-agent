const fs = require('fs');
const path = require('path');
const sharedEventEmitter = require('../utils/eventEmitter');
const logger = require('../utils/logger');

/**
 * Singleton that records every subsystem emission into a unified timeline array and
 * handles persistence & client broadcast via a follow-up 'timelineEvent' emission.
 */
class TimelineManager {
  constructor() {
    /** @type {Array<Object>} */
    this.events = [];

    /** Directory where backup timeline files are stored */
    this.logDir = path.join(process.cwd(), 'data', 'temp', 'log');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Register listeners only once.
    this._registerEmitterHooks();
  }

  /**
   * Append a new event to the in-memory timeline and re-emit it as 'timelineEvent'.
   * @param {string} subsystem
   * @param {string} title
   * @param {any} payload
   */
  record(subsystem, title, payload) {
    const evt = {
      subsystem,
      title,
      payload,
      receivedAt: new Date().toISOString()
    };

    this.events.push(evt);
    sharedEventEmitter.emit('timelineEvent', evt); // for SessionManager to broadcast
  }

  /** Return a shallow copy of current timeline */
  getEvents() {
    return [...this.events];
  }

  /** Archive current timeline to disk and clear in-memory array */
  reset() {
    if (this.events.length === 0) return;
    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `long_term_${iso}.bak`;
    const filepath = path.join(this.logDir, filename);
    try {
      fs.writeFileSync(filepath, JSON.stringify(this.events, null, 2));
      logger.debug('timeline', `Archived timeline to ${filepath}`);
      this._pruneBackups();
    } catch (err) {
      logger.error('timeline', 'Failed to archive timeline', err);
    }
    this.events = [];
  }

  /** Keep only the 10 most recent .bak files */
  _pruneBackups() {
    const files = fs.readdirSync(this.logDir)
      .filter(f => f.endsWith('.bak'))
      .map(f => ({ name: f, time: fs.statSync(path.join(this.logDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    for (let i = 10; i < files.length; i++) {
      try {
        fs.unlinkSync(path.join(this.logDir, files[i].name));
      } catch (err) {
        logger.error('timeline', 'Failed to delete old timeline backup', err);
      }
    }
  }

  _registerEmitterHooks() {
    const self = this;

    sharedEventEmitter.on('assistantResponse', data => {
      self.record('assistant', 'assistantResponse', data);
    });

    sharedEventEmitter.on('systemStatusMessage', data => {
      self.record('system', 'systemStatus', data);
    });

    sharedEventEmitter.on('subsystemMessage', data => {
      const subsystem = data.module || 'unknown';
      const title = `${subsystem}: ${data.title || data.event || 'message'}`;
      self.record(subsystem, title, data.content ?? data);
    });

    sharedEventEmitter.on('systemError', data => {
      const subsystem = data.module || 'system';
      const title = `${subsystem}: error`;
      self.record(subsystem, title, data);
    });

    sharedEventEmitter.on('debugResponse', data => {
      self.record('debug', 'debugResponse', data);
    });
  }
}

module.exports = new TimelineManager();

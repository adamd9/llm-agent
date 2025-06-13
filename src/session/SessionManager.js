const { v4: uuidv4 } = require('uuid');
const sharedEventEmitter = require('../utils/eventEmitter');
const logger = require('../utils/logger');
const core = require('../core');

class SessionManager {
  constructor(ego, options = {}) {
    this.ego = ego;
    this.sessionId = options.sessionId || 'main';
    this.history = [];
    this.clients = new Set();
    this.busy = false;
    this.idleTimeoutMs = (options.idleTimeoutSec || 1800) * 1000;
    this.retainExchanges = options.retainExchanges || 20;
    this.chatLogWriter = options.chatLogWriter || null;
    this._resetIdleTimer();

    this._registerAgentEvents();
  }

  _registerAgentEvents() {
    sharedEventEmitter.on('assistantResponse', async (data) => {
      this._logEvent({ role: 'assistant', content: data });
      await logger.debug('assistantResponse', 'Assistant response', { response: data });
      this._broadcast({ type: 'response', data: { response: data } });
      this._resetIdleTimer();
      this.busy = false;
    });

    sharedEventEmitter.on('systemStatusMessage', async (data) => {
      await logger.debug('working', 'Assistant working', { status: data });
      this._broadcast({ type: 'working', data: { status: data } });
    });

    sharedEventEmitter.on('subsystemMessage', async (data) => {
      await logger.debug('subsystem', `${data.module} subsystem message`, data);
      this._broadcast({ type: 'subsystem', data });
    });

    sharedEventEmitter.on('systemError', async (data) => {
      await logger.error('systemError', `${data.module} system error`, data);
      this._broadcast({ type: 'systemError', data });
    });

    sharedEventEmitter.on('debugResponse', (data) => {
      this._logEvent({ role: 'assistantDebug', content: data });
      this._broadcast({ type: 'debug', data });
    });
  }

  _logEvent(event) {
    this.history.push(event);
    if (this.chatLogWriter) {
      this.chatLogWriter.append(event);
    }
  }

  _broadcast(message) {
    for (const ws of this.clients) {
      try {
        ws.send(JSON.stringify(message));
      } catch (err) {
        logger.error('session', 'Failed to send WS message', { error: err.message });
      }
    }
  }

  _resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this._handleIdleTimeout(), this.idleTimeoutMs);
  }

  async _handleIdleTimeout() {
    // keep only last N exchanges in memory
    const exchanges = [];
    let count = 0;
    for (let i = this.history.length - 1; i >= 0 && count < this.retainExchanges * 2; i--) {
      exchanges.unshift(this.history[i]);
      if (this.history[i].role === 'assistant' || this.history[i].role === 'user') {
        count++;
      }
    }
    this.history = exchanges;
    if (this.chatLogWriter) {
      this.chatLogWriter.append({ type: 'session-audit', history: exchanges });
    }
    if (core.memory && typeof core.memory.consolidateShortTermToLongTerm === 'function') {
      await core.memory.consolidateShortTermToLongTerm();
    }
    this._broadcast({ type: 'reset', reason: 'idle-timeout', kept: this.retainExchanges });
    await logger.debug('session', 'Idle timeout triggered; history trimmed');
  }

  addClient(ws) {
    this.clients.add(ws);
    ws.send(JSON.stringify({ type: 'connected', sessionId: this.sessionId, resumed: true }));
    ws.on('close', () => {
      this.clients.delete(ws);
    });
  }

  async handleMessage(message) {
    if (this.busy) {
      return { error: 'busy' };
    }
    this.busy = true;
    this._logEvent({ role: 'user', content: message });
    this._broadcast({ type: 'user', data: { content: message } });
    this._resetIdleTimer();
    await this.ego.processMessage(message, this.history);
    return { ok: true };
  }
}

module.exports = SessionManager;

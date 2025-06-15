const { v4: uuidv4 } = require('uuid');
const sharedEventEmitter = require('../utils/eventEmitter');
const logger = require('../utils/logger');
const core = require('../core');

class SessionManager {
  constructor(ego, options = {}) {
    this.ego = ego;
    this.sessionId = options.sessionId || uuidv4();
    this.clients = new Set();
    this.busy = false;
    this.idleTimeoutMs = (options.idleTimeoutSec || 1800) * 1000;
    this.idleTimer = null;
    this.retainExchanges = options.retainExchanges || 20;
    this.history = [];
    this.chatLogWriter = options.chatLogWriter || null;
    
    // For cancellation support
    this.abortController = null;
    this.currentProcessingTask = null;
    
    // For system status tracking
    this.systemStatus = {
      state: 'ready', // ready, processing, error
      message: 'System ready',
      timestamp: new Date().toISOString()
    };
    
    // Initialize and load history
    this._initializeHistory();
    this._resetIdleTimer();
    this._registerAgentEvents();
  }
  
  /**
   * Initialize session history from chat log file if available
   * @private
   */
  async _initializeHistory() {
    if (this.chatLogWriter) {
      try {
        // Load history from file with a limit of retainExchanges * 2 entries
        // (to account for both user and assistant messages in exchanges)
        const loadedHistory = await this.chatLogWriter.readHistory({
          limit: this.retainExchanges * 2,
          roles: ['user', 'assistant'] // Only load actual conversation messages
        });
        
        if (loadedHistory && loadedHistory.length > 0) {
          this.history = loadedHistory;
          logger.debug('session', `Loaded ${loadedHistory.length} history entries from file`);
        } else {
          logger.debug('session', 'No history entries loaded from file');
        }
      } catch (err) {
        logger.error('session', 'Failed to load history from file', { error: err.message });
      }
    }
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
    const messageStr = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }
  
  /**
   * Update the system status and broadcast to all clients
   * @param {string} state - The system state (ready, processing, error)
   * @param {string} message - The status message
   */
  updateSystemStatus(state, message) {
    this.systemStatus = {
      state,
      message,
      timestamp: new Date().toISOString()
    };
    
    // Broadcast the status update to all clients
    this._broadcast({
      type: 'systemStatus',
      data: this.systemStatus
    });
    
    // Log the status update
    logger.debug('session', `System status: ${state} - ${message}`);
  }

  _resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this._handleIdleTimeout(), this.idleTimeoutMs);
  }

  async _handleIdleTimeout() {
    await sharedEventEmitter.emit('idleTimeout');
    await this._performCleanup({ reason: 'idle-timeout' });
    await logger.debug('session', 'Idle timeout triggered; history trimmed');
  }

  async _performCleanup({ reason = 'sleep', clearHistory = false, consolidateMemory = true } = {}) {
    // Update system status
    this.updateSystemStatus('processing', 'Cleaning up session...');

    // Clear or trim history first so cleanup logs remain visible
    let kept = this.retainExchanges;

    if (clearHistory) {
      this.history = [];
      kept = 0;
    } else {
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
    }

    // Cancel any ongoing processing
    if (this.busy) {
      await this.cancelProcessing();
    }

    // Consolidate memory if requested
    if (consolidateMemory && core.memory && typeof core.memory.consolidateShortTermToLongTerm === 'function') {
      await core.memory.consolidateShortTermToLongTerm();
    }

    if (this.chatLogWriter) {
      this.chatLogWriter.append({
        type: 'session-audit',
        action: 'cleanup',
        reason,
        timestamp: new Date().toISOString(),
        kept
      });
    }

    this._broadcast({
      type: 'sleep',
      reason,
      clearHistory,
      kept,
      timestamp: new Date().toISOString()
    });

    await sharedEventEmitter.emit('sleep', { reason });

    this.updateSystemStatus('ready', 'Session cleanup complete');

    return { ok: true, message: 'Session cleanup successful' };
  }

  /**
   * Add a new client connection and send them the current session state
   * @param {WebSocket} ws - The WebSocket client to add
   */
  addClient(ws) {
    this.clients.add(ws);
    
    // Send connected event with session info
    ws.send(JSON.stringify({ 
      type: 'connected', 
      sessionId: this.sessionId, 
      resumed: true,
      historyAvailable: this.history.length > 0
    }));
    
    // Send current system status to the client
    ws.send(JSON.stringify({
      type: 'systemStatus',
      data: this.systemStatus
    }));
    
    // Send history to the client if available
    if (this.history.length > 0) {
      // Send each history item as individual messages
      this.history.forEach(item => {
        if (item.role === 'user') {
          ws.send(JSON.stringify({ type: 'user', data: { content: item.content } }));
        } else if (item.role === 'assistant') {
          ws.send(JSON.stringify({ type: 'response', data: { response: item.content } }));
        } else if (item.role === 'assistantDebug') {
          ws.send(JSON.stringify({ type: 'debug', data: item.content }));
        }
      });
    }
    
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
    
    // Update system status to processing
    this.updateSystemStatus('processing', 'Processing message...');
    
    // Create a new AbortController for this processing task
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    
    try {
      // Store the processing task as a promise
      this.currentProcessingTask = this.ego.processMessage(message, this.history);
      
      // Set up a listener for the abort signal
      signal.addEventListener('abort', () => {
        // This will be handled in the catch block below
        throw new Error('Processing cancelled by user');
      }, { once: true });
      
      // Wait for the processing to complete
      await this.currentProcessingTask;
      
      // Clean up
      this.currentProcessingTask = null;
      this.abortController = null;
      
      // Update system status to ready
      this.updateSystemStatus('ready', 'Processing complete');

      await sharedEventEmitter.emit('conversationEnd');

      return { ok: true };
    } catch (error) {
      if (signal.aborted) {
        // Handle cancellation
        this._logEvent({ role: 'system', content: 'Request cancelled by user' });
        this._broadcast({ type: 'cancelled', reason: 'user-requested' });
        await logger.debug('session', 'Processing cancelled by user');
        
        // Update system status to ready after cancellation
        this.updateSystemStatus('ready', 'Request cancelled');
      } else {
        // Handle other errors
        this._logEvent({ role: 'system', content: `Error: ${error.message}` });
        this._broadcast({ type: 'error', error: { message: error.message } });
        await logger.error('session', 'Error processing message', { error: error.message });
        
        // Update system status to error
        this.updateSystemStatus('error', `Error: ${error.message}`);
      }
      
      // Clean up
      this.currentProcessingTask = null;
      this.abortController = null;
      this.busy = false;
      
      return signal.aborted ? { cancelled: true } : { error: error.message };
    } finally {
      this.busy = false;
    }
  }
  
  /**
   * Cancel the current processing task if one is running
   * @returns {Object} Result of the cancellation attempt
   */
  async cancelProcessing() {
    if (!this.busy || !this.abortController) {
      return { error: 'no-active-request' };
    }
    
    try {
      // Abort the current processing task
      this.abortController.abort();
      
      // Wait a short time for the abort to propagate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Force reset busy state if it hasn't been reset
      this.busy = false;
      
      return { ok: true, message: 'Processing cancelled' };
    } catch (error) {
      await logger.error('session', 'Error cancelling processing', { error: error.message });
      return { error: 'cancel-failed', message: error.message };
    }
  }
  
  /**
   * Reset the session state
   * @param {Object} options - Reset options
   * @param {boolean} options.clearHistory - Whether to clear the history completely (default: false)
   * @param {boolean} options.consolidateMemory - Whether to consolidate memory before reset (default: true)
   * @param {string} options.reason - Reason for the reset (default: 'user-requested')
   * @returns {Object} Result of the reset operation
   */
  async sleep(options = {}) {
    const clearHistory = options.clearHistory === true;
    const consolidateMemory = options.consolidateMemory !== false;
    const reason = options.reason || 'user-sleep';

    return this._performCleanup({ reason, clearHistory, consolidateMemory });
  }

  // Backwards compatibility
  async resetSession(options = {}) {
    return this.sleep(options);
  }
}

module.exports = SessionManager;

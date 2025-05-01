const debug = require('debug');
const sharedEventEmitter = require('./eventEmitter');
const PREFIX = 'llm-agent';

class Logger {
    constructor() {
        this.debugInstance = debug(PREFIX);
        this.wsConnections = new Map();
    }

    setWSConnections(connections) {
        this.wsConnections = connections;
    }

    /**
     * Safely stringifies data, handling circular references
     * @param {any} data - Data to stringify
     * @param {string} [context] - Context for safeStringify
     * @returns {string} - Stringified data
     */
    safeStringify(data, context) {
        if (typeof data !== 'object' || data === null) {
            return String(data);
        }

        try {
            return JSON.stringify(data, null, 2);
        } catch (error) {
            if (error.message.includes('circular')) {
                return `[Object with circular reference - unable to display full contents in ${context}]`;
            }
            return `[Error stringifying object in ${context}: ${error.message}]`;
        }
    }

    /**
     * Log a debug message
     * @param {string} context - Context for the log message
     * @param {string} message - Log message
     * @param {*} [data] - Optional data to log
     * @param {string|boolean} [sendToUser=true] - If string, used as context for safeStringify. If boolean, controls whether to send to connected users
     */
    async debug(context, message, data = {}, sendToUser = true) {
        // Handle if message is an object
        if (typeof message === 'object') {
            data = message;
            message = '';
        }

        const debugInfo = {
            timestamp: new Date().toISOString(),
            type: 'debug',
            context,
            message,
            data: typeof data === 'object' ? JSON.parse(this.safeStringify(data, typeof sendToUser === 'string' ? sendToUser : context)) : data
        };

        // Log to debug console
        this.debugInstance(JSON.stringify(debugInfo));

        // Send to websocket connections if enabled
        if (sendToUser === true || typeof sendToUser === 'string') {
            await sharedEventEmitter.emit('debugResponse', debugInfo);
        }
    }

    /**
     * Log an error message
     * @param {string} context - Context for the error
     * @param {string|Error} error - Error message or Error object
     * @param {*} [data] - Optional data to log
     * @param {boolean} [sendToUser=true] - Whether to send to connected users
     */
    async error(context, error, data = {}, sendToUser = true) {
        // Handle if error is an object
        if (typeof error === 'object' && !(error instanceof Error)) {
            data = error;
            error = '';
        }

        const errorInfo = {
            context,
            message: error instanceof Error ? error.stack || error.message : error,
            data,
            timestamp: new Date().toISOString()
        };

        const dataString = this.safeStringify(data);
        console.error(`[${context}] ${errorInfo.message}`, dataString);

        if (sendToUser !== false) {
            await sharedEventEmitter.emit('debugResponse', errorInfo);
        }
    }

    // Helper method for code blocks
    code(message, language = 'javascript', metadata = {}) {
        this.response(message, { format: 'code', language, metadata });
    }
}

// Create a singleton instance
const logger = new Logger();

module.exports = logger;

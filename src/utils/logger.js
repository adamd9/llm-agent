const debug = require('debug');
const sharedEventEmitter = require('./eventEmitter');
const PREFIX = 'llm-agent';

class Logger {
    constructor() {
        this.debug = debug(PREFIX);
        this.wsConnections = new Map();
    }

    setWSConnections(connections) {
        this.wsConnections = connections;
    }

    /**
     * Safely stringifies data, handling circular references
     * @param {any} data - Data to stringify
     * @returns {string} - Stringified data
     */
    safeStringify(data) {
        if (typeof data !== 'object' || data === null) {
            return String(data);
        }

        try {
            return JSON.stringify(data, null, 2);
        } catch (error) {
            if (error.message.includes('circular')) {
                return '[Object with circular reference - unable to display full contents]';
            }
            return `[Error stringifying object: ${error.message}]`;
        }
    }

    /**
     * Log a debug message
     * @param {string} context - Context for the log message
     * @param {string} message - Log message
     * @param {*} [data] - Optional data to log
     * @param {boolean} [sendToUser=true] - Whether to send to connected users
     */
    async debug(context, message, data = {}, sendToUser = true) {
        // Handle if message is an object
        if (typeof message === 'object') {
            data = message;
            message = '';
        }

        const debugInfo = {
            context,
            message,
            data,
            timestamp: new Date().toISOString()
        };

        const dataString = this.safeStringify(data);
        console.log(`[${context}] ${message}`, dataString);

        if (sendToUser !== false) {
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

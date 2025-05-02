const debug = require('debug');
const sharedEventEmitter = require('./eventEmitter');
const fs = require('fs').promises;
const path = require('path');
const safeStringify = require('./safeStringify');
const PREFIX = 'llm-agent';

class Logger {
    constructor() {
        this.debugInstance = debug(PREFIX);
        this.wsConnections = new Map();
        this.sessionId = null;
        this.outputPath = null;
        this.messages = [];
    }

    setWSConnections(connections) {
        this.wsConnections = connections;
    }

    async initialize(sessionId) {
        this.sessionId = sessionId;
        // Use absolute path to data/temp directory
        const tempDir = path.join(process.cwd(), 'data', 'temp');
        
        // Ensure temp directory exists
        try {
            await fs.access(tempDir);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.mkdir(tempDir, { recursive: true });
            }
        }
        
        // Create filename with datetime stamp
        const now = new Date();
        const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19); // Format: YYYY-MM-DDTHH-mm-ss
        this.outputPath = path.join(tempDir, `${dateStr}_session_${sessionId}.json`);
        this.messages = [];
    }

    async writeToFile() {
        if (!this.sessionId || !this.outputPath) return;
        
        try {
            // Ensure directory exists
            const dir = path.dirname(this.outputPath);
            await fs.mkdir(dir, { recursive: true });
            
            // Write messages to file
            const data = {
                sessionId: this.sessionId,
                messages: this.messages,
                timestamp: new Date().toISOString()
            };
            
            await fs.writeFile(this.outputPath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[logger] Error writing to file:', error);
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
        // Log to console
        console.log(`[logger] ${context}: ${message}`, data);

        // Add to messages array
        const logMessage = {
            timestamp: new Date().toISOString(),
            type: 'stdout',
            data: {
                level: 'log',
                message: [`[logger] ${context}: ${message}`, data]
            }
        };
        this.messages.push(logMessage);

        // Write to file
        await this.writeToFile();

        // Send to WebSocket if needed
        if (sendToUser && this.wsConnections) {
            const debugMessage = {
                type: 'debug',
                context,
                message,
                data,
                timestamp: new Date().toISOString()
            };
            
            for (const [sessionId, ws] of this.wsConnections) {
                if (sessionId === this.sessionId) {
                    ws.send(safeStringify({
                        type: 'debug',
                        data: debugMessage
                    }, 'logger.debug'));
                }
            }
        }
    }

    /**
     * Log an error message
     * @param {string} context - Context for the error
     * @param {string|Error} error - Error message or Error object
     * @param {*} [data] - Optional data to log
     * @param {boolean} [sendToUser=true] - Whether to send to connected users
     */
    async error(context, message, error = {}) {
        // Log to console
        console.error(`[logger] Error in ${context}: ${message}`, error);

        // Add to messages array
        const logMessage = {
            timestamp: new Date().toISOString(),
            type: 'stdout',
            data: {
                level: 'error',
                message: [`[logger] Error in ${context}: ${message}`, error]
            }
        };
        this.messages.push(logMessage);

        // Write to file
        await this.writeToFile();

        // Send to WebSocket if needed
        if (this.wsConnections) {
            const errorMessage = {
                type: 'error',
                context,
                message,
                error: {
                    message: error.message || error,
                    stack: error.stack,
                },
                timestamp: new Date().toISOString()
            };

            for (const [sessionId, ws] of this.wsConnections) {
                if (sessionId === this.sessionId) {
                    ws.send(safeStringify({
                        type: 'error',
                        data: errorMessage
                    }, 'logger.error'));
                }
            }
        }
    }
}

// Create a singleton instance
const logger = new Logger();

module.exports = logger;

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
        this.isLogging = false; // Guard against recursive logging
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
        
        this.outputPath = path.join(tempDir, `session_${sessionId}.json`);
        this.messages = [];
        console.log(`[logger] Initialized logger for session ${sessionId} at ${this.outputPath}`);
    }

    async writeToFile() {
        if (!this.sessionId || !this.outputPath || this.isLogging) return;
        
        try {
            this.isLogging = true;
            
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
            console.log(`[logger] Wrote ${this.messages.length} messages to ${this.outputPath}`);
        } catch (error) {
            console.error('[logger] Error writing to file:', error);
            console.error('[logger] Failed path:', this.outputPath);
        } finally {
            this.isLogging = false;
        }
    }

    async logMessage(type, data) {
        if (!this.sessionId || this.isLogging) return;

        try {
            this.isLogging = true;
            // Create a new message object without any references to this.messages
            const message = {
                timestamp: new Date().toISOString(),
                type,
                data: JSON.parse(JSON.stringify(data)) // Deep clone to break any circular references
            };

            this.messages.push(message);
            await this.writeToFile();
        } catch (error) {
            console.error('[logger] Error logging message:', error);
        } finally {
            this.isLogging = false;
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
        if (this.isLogging) return;

        const timestamp = new Date().toISOString();
        const debugMessage = {
            type: 'debug',
            context,
            message,
            data,
            timestamp
        };

        // Add to messages array
        this.messages.push(debugMessage);

        // Write to file
        await this.writeToFile();

        // Log to console
        console.log(`[logger] ${context}: ${message}`, data);

        // Send to WebSocket if needed
        if (sendToUser && this.wsConnections) {
            for (const [sessionId, ws] of this.wsConnections) {
                if (sessionId === this.sessionId) {
                    ws.send(JSON.stringify({
                        type: 'debug',
                        data: debugMessage
                    }));
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
        if (this.isLogging) return;

        const timestamp = new Date().toISOString();
        const errorMessage = {
            type: 'error',
            context,
            message,
            error: {
                message: error.message || error,
                stack: error.stack,
            },
            timestamp
        };

        // Add to messages array
        this.messages.push(errorMessage);

        // Write to file
        await this.writeToFile();

        // Log to console
        console.error(`[logger] Error in ${context}: ${message}`, error);

        // Send to WebSocket
        if (this.wsConnections) {
            for (const [sessionId, ws] of this.wsConnections) {
                if (sessionId === this.sessionId) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        data: errorMessage
                    }));
                }
            }
        }
    }
}

// Create a singleton instance
const logger = new Logger();

module.exports = logger;

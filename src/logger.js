const WebSocket = require('ws');

class Logger {
    constructor() {
        this.wsConnections = new Map();
    }

    setWSConnections(connections) {
        this.wsConnections = connections;
    }

    debug(context, message, data = {}) {
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

        // Console output
        console.log(`[${context}] ${message}`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);

        // Send to WebSocket clients
        if (this.wsConnections) {
            for (const [sessionId, ws] of this.wsConnections.entries()) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'debug',
                        data: debugInfo
                    }));
                }
            }
        }
    }

    response(message, options = {}) {
        // Console output for tracking
        console.log(`[RESPONSE] ${message}`);

        // Send to WebSocket clients
        if (this.wsConnections) {
            for (const [sessionId, ws] of this.wsConnections.entries()) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'response',
                        data: {
                            response: message,
                            format: options.format || 'text', // 'text', 'markdown', 'code'
                            language: options.language, // for code blocks
                            metadata: options.metadata // any additional formatting metadata
                        }
                    }));
                }
            }
        }
    }

    // Helper method for markdown responses
    markdown(message, metadata = {}) {
        this.response(message, { format: 'markdown', metadata });
    }

    // Helper method for code blocks
    code(message, language = 'javascript', metadata = {}) {
        this.response(message, { format: 'code', language, metadata });
    }
}

// Create a singleton instance
const logger = new Logger();

module.exports = logger;

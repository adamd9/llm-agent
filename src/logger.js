const sharedEventEmitter = require('./eventEmitter');
class Logger {
    constructor() {
        this.wsConnections = new Map();
    }

    setWSConnections(connections) {
        this.wsConnections = connections;
    }

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

        const dataString = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
        console.log(`[${context}] ${message}`, dataString);

        if (sendToUser !==false) {
            await sharedEventEmitter.emit('debugResponse', debugInfo);
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

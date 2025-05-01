const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class CLILogger {
    constructor() {
        this.sessionId = null;
        this.outputPath = null;
        this.messages = [];
    }

    initialize(sessionId) {
        this.sessionId = sessionId;
        this.outputPath = path.join(__dirname, '../../data/temp', `session_${sessionId}.json`);
        this.messages = [];
        logger.debug('cliLogger', 'Initialized CLI logger', { sessionId, outputPath: this.outputPath });
    }

    async logMessage(type, data) {
        if (!this.sessionId) return;

        try {
            const message = {
                timestamp: new Date().toISOString(),
                type,
                data
            };

            this.messages.push(message);
            await this.writeToFile();
        } catch (error) {
            logger.error('cliLogger', 'Error logging message', error);
        }
    }

    async writeToFile() {
        if (!this.outputPath) return;
        
        try {
            await fs.writeFile(
                this.outputPath,
                JSON.stringify({ 
                    sessionId: this.sessionId, 
                    messages: this.messages 
                }, null, 2)
            );
            logger.debug('cliLogger', 'Successfully wrote to file', { outputPath: this.outputPath });
        } catch (error) {
            logger.error('cliLogger', 'Error writing to file', error);
            throw error; // Re-throw to handle in calling function
        }
    }
}

// Export singleton instance
module.exports = new CLILogger();

const fs = require('fs').promises;
const path = require('path');
const safeStringify = require('./safeStringify');

class CLILogger {
    constructor() {
        this.sessionId = null;
        this.outputPath = null;
        this.messages = [];
        this.isLogging = false; // Guard against recursive logging
    }

    initialize(sessionId) {
        this.sessionId = sessionId;
        this.outputPath = path.join(__dirname, '../../data/temp', `session_${sessionId}.json`);
        this.messages = [];
        console.log(`[cliLogger] Initialized CLI logger for session ${sessionId}`);
    }

    async logMessage(type, data) {
        if (!this.sessionId || this.isLogging) return;

        try {
            this.isLogging = true;
            const message = {
                timestamp: new Date().toISOString(),
                type,
                data
            };

            this.messages.push(message);
            await this.writeToFile();
        } catch (error) {
            console.error('[cliLogger] Error logging message:', error);
        } finally {
            this.isLogging = false;
        }
    }

    async writeToFile() {
        if (!this.outputPath) return;
        
        try {
            await fs.writeFile(
                this.outputPath,
                safeStringify({ 
                    sessionId: this.sessionId, 
                    messages: this.messages 
                })
            );
            console.log('[cliLogger] Successfully wrote to file:', this.outputPath);
        } catch (error) {
            console.error('[cliLogger] Error writing to file:', error);
        }
    }
}

// Export singleton instance
module.exports = new CLILogger();

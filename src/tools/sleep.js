const logger = require('../utils/logger');
const scheduler = require('../core/scheduler');

class SleepTool {
    constructor() {
        this.name = 'sleep';
        this.description = 'Tool for performing session cleanup operations';
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'sleep',
                    description: 'Trigger session cleanup and memory consolidation',
                    parameters: [
                        { name: 'clearHistory', description: 'Clear entire conversation history', type: 'boolean', required: false },
                        { name: 'consolidateMemory', description: 'Consolidate short term to long term memory', type: 'boolean', required: false },
                        { name: 'reason', description: 'Reason for sleeping', type: 'string', required: false }
                    ]
                }
            ]
        };
    }

    async sleep(params) {
        if (!scheduler.sessionManager) {
            logger.error('SleepTool', 'Session manager unavailable');
            return { status: 'error', error: 'session-manager-unavailable' };
        }

        const options = {
            clearHistory: false,
            consolidateMemory: true,
            reason: 'tool-sleep'
        };

        const ch = params.find(p => p.name === 'clearHistory');
        if (ch) options.clearHistory = ch.value === true || ch.value === 'true';

        const cm = params.find(p => p.name === 'consolidateMemory');
        if (cm) options.consolidateMemory = !(cm.value === false || cm.value === 'false');

        const reason = params.find(p => p.name === 'reason');
        if (reason && reason.value) options.reason = String(reason.value);

        try {
            const result = await scheduler.sessionManager.sleep(options);
            if (result && result.error) {
                return { status: 'error', error: result.message || result.error };
            }
            return { status: 'success', message: result.message || 'Sleep successful' };
        } catch (err) {
            logger.error('SleepTool', 'Sleep failed', { error: err.message });
            return { status: 'error', error: err.message };
        }
    }

    async execute(action, parameters) {
        let parsed = parameters;
        if (typeof parameters === 'string') {
            try {
                parsed = JSON.parse(parameters);
            } catch (e) {
                return { status: 'error', error: 'Invalid parameters JSON' };
            }
        }

        if (!Array.isArray(parsed)) {
            parsed = Object.entries(parsed || {}).map(([name, value]) => ({ name, value }));
        }

        switch (action) {
            case 'sleep':
                return await this.sleep(parsed);
            default:
                return { status: 'error', error: `Unknown action: ${action}` };
        }
    }
}

module.exports = new SleepTool();

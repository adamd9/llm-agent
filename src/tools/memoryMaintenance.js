const logger = require('../utils/logger');
const memory = require('../core/memory');
const scheduler = require('../core/scheduler');

/**
 * MemoryMaintenanceTool - Heavyweight tool for deep memory maintenance tasks.
 * This consolidates logic previously spread across evaluator, consolidation,
 * and sleep cleanup functions. Additional heavy LLM operations should live here.
 */
class MemoryMaintenanceTool {
    constructor() {
        this.name = 'memoryMaintenance';
        this.description = 'Tool for deep memory consolidation and cleanup';
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                { name: 'consolidate', description: 'Consolidate long-term memory', parameters: [] },
                { name: 'cleanup', description: 'Session cleanup (previously sleep)', parameters: [] }
            ]
        };
    }

    /**
     * Lightweight wrapper to trigger long-term memory consolidation.
     * Real logic is delegated to core/memory where heavy LLM call resides.
     */
    async consolidate() {
        try {
            const result = await memory.consolidateLongTerm();
            return { status: 'success', ...result };
        } catch (error) {
            logger.error('MemoryMaintenanceTool', 'Consolidation failed', { error: error.message });
            return { status: 'error', error: error.message };
        }
    }

    /**
     * Session cleanup previously handled by SleepTool. Delegates to SessionManager.
     */
    async cleanup(opts = {}) {
        if (!scheduler.sessionManager) {
            return { status: 'error', error: 'session-manager-unavailable' };
        }
        try {
            const result = await scheduler.sessionManager.sleep({
                clearHistory: opts.clearHistory ?? false,
                consolidateMemory: opts.consolidateMemory ?? true,
                reason: opts.reason || 'maintenance-cleanup'
            });
            return result.error ? { status: 'error', error: result.error } : { status: 'success', ...result };
        } catch (error) {
            logger.error('MemoryMaintenanceTool', 'Cleanup failed', { error: error.message });
            return { status: 'error', error: error.message };
        }
    }


    /**
     * Generic executor used by scheduler/task-planner.
     */
    async execute(action, parameters) {
        let parsed = parameters;
        if (typeof parameters === 'string') {
            try { parsed = JSON.parse(parameters); } catch { parsed = {}; }
        }

        switch (action) {
            case 'consolidate':
                return await this.consolidate(parsed);
            case 'cleanup':
                return await this.cleanup(parsed);
            default:
                return { status: 'error', error: `Unknown action: ${action}` };
        }
    }
}

module.exports = new MemoryMaintenanceTool();

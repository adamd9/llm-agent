const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DATA_DIR_PATH } = require('../../utils/dataDir');
const logger = require('../../utils/logger');
const sharedEventEmitter = require('../../utils/eventEmitter');
const toolManager = require('../../mcp');

const schedulerDir = path.join(DATA_DIR_PATH, 'scheduler');
const tasksFile = path.join(schedulerDir, 'tasks.json');

class Scheduler {
    constructor() {
        // id => { config, timer?, listener? }
        this.tasks = new Map();
        this.sessionManager = null;
    }

    async initialize(sessionManager) {
        this.sessionManager = sessionManager;
        if (!fs.existsSync(schedulerDir)) {
            fs.mkdirSync(schedulerDir, { recursive: true });
        }
        if (!fs.existsSync(tasksFile)) {
            fs.writeFileSync(tasksFile, '[]', 'utf-8');
        }
        this.loadTasksFromFile();
        // Emit startup event for any tasks listening for it
        sharedEventEmitter.emit('startup');
    }

    loadTasksFromFile() {
        try {
            const data = fs.readFileSync(tasksFile, 'utf-8');
            const tasks = JSON.parse(data);
            tasks.forEach(t => {
                if (t.eventName) {
                    this.scheduleEventTask(t);
                } else {
                    this.scheduleIntervalTask(t);
                }
            });
        } catch (err) {
            logger.error('scheduler', 'Failed to load tasks', { error: err.message });
        }
    }

    saveTasksToFile() {
        try {
            const tasks = Array.from(this.tasks.values()).map(t => t.config);
            fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), 'utf-8');
        } catch (err) {
            logger.error('scheduler', 'Failed to save tasks', { error: err.message });
        }
    }

    scheduleIntervalTask(config) {
        if (!config.id) config.id = uuidv4();
        const timer = setInterval(() => this.runTask(config.id), config.frequencySec * 1000);
        this.tasks.set(config.id, { config, timer });
    }

    scheduleEventTask(config) {
        if (!config.id) config.id = uuidv4();
        const listener = () => this.runTask(config.id);
        sharedEventEmitter.on(config.eventName, listener);
        this.tasks.set(config.id, { config, listener });
    }

    runTask(id) {
        const taskEntry = this.tasks.get(id);
        if (!taskEntry) return;
        const { config } = taskEntry;
        config.lastRun = Date.now();
        this.saveTasksToFile();
        if (config.toolName) {
            const tool = toolManager.getTool(config.toolName);
            if (tool) {
                tool.execute(config.action || 'sleep', config.parameters || []).catch(err => {
                    logger.error('scheduler', 'Tool task failed', { error: err.message });
                });
            } else {
                logger.error('scheduler', `Tool not found: ${config.toolName}`);
            }
        } else if (config.message) {
            if (!this.sessionManager) {
                logger.error('scheduler', 'No session manager available for task');
                return;
            }
            this.sessionManager.handleMessage(config.message).catch(err => {
                logger.error('scheduler', 'Task execution failed', { error: err.message });
            });
        }
    }

    registerTask(message, frequencySec) {
        const config = { id: uuidv4(), message, frequencySec, lastRun: 0 };
        this.scheduleIntervalTask(config);
        this.saveTasksToFile();
        return config;
    }

    registerToolTask(toolName, action, parameters, frequencySec) {
        const config = { id: uuidv4(), toolName, action, parameters, frequencySec, lastRun: 0 };
        this.scheduleIntervalTask(config);
        this.saveTasksToFile();
        return config;
    }

    registerEventTask(eventName, message) {
        const config = { id: uuidv4(), eventName, message };
        this.scheduleEventTask(config);
        this.saveTasksToFile();
        return config;
    }

    registerEventToolTask(eventName, toolName, action, parameters) {
        const config = { id: uuidv4(), eventName, toolName, action, parameters };
        this.scheduleEventTask(config);
        this.saveTasksToFile();
        return config;
    }

    removeTask(id) {
        const entry = this.tasks.get(id);
        if (!entry) return false;
        if (entry.timer) clearInterval(entry.timer);
        if (entry.listener && entry.config.eventName) {
            sharedEventEmitter.off(entry.config.eventName, entry.listener);
        }
        this.tasks.delete(id);
        this.saveTasksToFile();
        return true;
    }

    listTasks() {
        return Array.from(this.tasks.values()).map(t => t.config);
    }
}

module.exports = new Scheduler();

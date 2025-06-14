const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DATA_DIR_PATH } = require('../../utils/dataDir');
const logger = require('../../utils/logger');

const schedulerDir = path.join(DATA_DIR_PATH, 'scheduler');
const tasksFile = path.join(schedulerDir, 'tasks.json');

class Scheduler {
    constructor() {
        this.tasks = new Map(); // id => { config, timer }
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
    }

    loadTasksFromFile() {
        try {
            const data = fs.readFileSync(tasksFile, 'utf-8');
            const tasks = JSON.parse(data);
            tasks.forEach(t => this.scheduleTask(t));
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

    scheduleTask(config) {
        if (!config.id) config.id = uuidv4();
        const timer = setInterval(() => this.runTask(config.id), config.frequencySec * 1000);
        this.tasks.set(config.id, { config, timer });
    }

    runTask(id) {
        const taskEntry = this.tasks.get(id);
        if (!taskEntry) return;
        const { config } = taskEntry;
        config.lastRun = Date.now();
        this.saveTasksToFile();
        if (!this.sessionManager) {
            logger.error('scheduler', 'No session manager available for task');
            return;
        }
        this.sessionManager.handleMessage(config.message).catch(err => {
            logger.error('scheduler', 'Task execution failed', { error: err.message });
        });
    }

    registerTask(message, frequencySec) {
        const config = { id: uuidv4(), message, frequencySec, lastRun: 0 };
        this.scheduleTask(config);
        this.saveTasksToFile();
        return config;
    }

    removeTask(id) {
        const entry = this.tasks.get(id);
        if (!entry) return false;
        clearInterval(entry.timer);
        this.tasks.delete(id);
        this.saveTasksToFile();
        return true;
    }

    listTasks() {
        return Array.from(this.tasks.values()).map(t => t.config);
    }
}

module.exports = new Scheduler();

const logger = require('../utils/logger');
const scheduler = require('../core/scheduler');

class SchedulerTool {
    constructor() {
        this.name = 'scheduler';
        this.description = 'Tool for managing scheduled tasks';
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'addTask',
                    description: 'Add a scheduled task',
                    parameters: [
                        { name: 'message', description: 'Message to process', type: 'string', required: true },
                        { name: 'frequencySec', description: 'How often to run in seconds', type: 'number', required: true }
                    ]
                },
                {
                    name: 'removeTask',
                    description: 'Remove a task by id',
                    parameters: [ { name: 'id', description: 'Task id', type: 'string', required: true } ]
                },
                {
                    name: 'listTasks',
                    description: 'List scheduled tasks',
                    parameters: []
                },
                {
                    name: 'viewTasks',
                    description: 'Alias for listTasks',
                    parameters: []
                }
            ]
        };
    }

    async addTask(params) {
        const msgParam = params.find(p => p.name === 'message');
        const freqParam = params.find(p => p.name === 'frequencySec');
        if (!msgParam || !freqParam) {
            throw new Error('message and frequencySec are required');
        }
        const task = scheduler.registerTask(msgParam.value, Number(freqParam.value));
        return { status: 'success', task };
    }

    async removeTask(params) {
        const idParam = params.find(p => p.name === 'id');
        if (!idParam) throw new Error('id is required');
        const success = scheduler.removeTask(idParam.value);
        return success ? { status: 'success' } : { status: 'error', error: 'Task not found' };
    }

    async listTasks() {
        const tasks = scheduler.listTasks();
        return { status: 'success', tasks };
    }

    async viewTasks() {
        return this.listTasks();
    }

    async execute(action, parameters) {
        try {
            let parsed = parameters;
            if (typeof parameters === 'string') {
                parsed = JSON.parse(parameters);
            }
            switch(action) {
                case 'addTask':
                    return await this.addTask(parsed);
                case 'removeTask':
                    return await this.removeTask(parsed);
                case 'listTasks':
                    return await this.listTasks();
                case 'viewTasks':
                    return await this.viewTasks();
                default:
                    return { status: 'error', error: `Unknown action: ${action}` };
            }
        } catch (err) {
            logger.error('SchedulerTool', 'Execution failed', { error: err.message });
            return { status: 'error', error: err.message };
        }
    }
}

module.exports = new SchedulerTool();

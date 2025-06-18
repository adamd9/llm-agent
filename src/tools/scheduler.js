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
                    description: 'Add a scheduled message task',
                    parameters: [
                        { name: 'message', description: 'Message to process', type: 'string', required: true },
                        { name: 'frequencySec', description: 'How often to run in seconds', type: 'number', required: true }
                    ]
                },
                {
                    name: 'addToolTask',
                    description: 'Add a scheduled tool task',
                    parameters: [
                        { name: 'toolName', description: 'Tool to execute', type: 'string', required: true },
                        { name: 'action', description: 'Tool action', type: 'string', required: true },
                        { name: 'parameters', description: 'Action parameters (JSON)', type: 'string', required: false },
                        { name: 'frequencySec', description: 'How often to run in seconds', type: 'number', required: true }
                    ]
                },
                {
                    name: 'addEventTask',
                    description: 'Trigger a message when an event occurs',
                    parameters: [
                        { name: 'eventName', description: 'Event to listen for (see listEvents)', type: 'string', required: true },
                        { name: 'message', description: 'Message to process', type: 'string', required: true }
                    ]
                },
                {
                    name: 'addEventToolTask',
                    description: 'Trigger a tool when an event occurs',
                    parameters: [
                        { name: 'eventName', description: 'Event to listen for (see listEvents)', type: 'string', required: true },
                        { name: 'toolName', description: 'Tool to execute', type: 'string', required: true },
                        { name: 'action', description: 'Tool action', type: 'string', required: true },
                        { name: 'parameters', description: 'Action parameters (JSON)', type: 'string', required: false }
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
                },
                {
                    name: 'listEvents',
                    description: 'List available scheduler trigger events',
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

    async addToolTask(params) {
        const toolName = params.find(p => p.name === 'toolName');
        const action = params.find(p => p.name === 'action');
        const freq = params.find(p => p.name === 'frequencySec');
        const paramStr = params.find(p => p.name === 'parameters');
        if (!toolName || !action || !freq) {
            throw new Error('toolName, action and frequencySec are required');
        }
        let parsedParams = [];
        if (paramStr && paramStr.value) {
            try {
                parsedParams = JSON.parse(paramStr.value);
            } catch (e) {
                logger.error('SchedulerTool', 'Parameter parse error', { error: e.message });
            }
        }
        const task = scheduler.registerToolTask(toolName.value, action.value, parsedParams, Number(freq.value));
        return { status: 'success', task };
    }

    async addEventTask(params) {
        const eventName = params.find(p => p.name === 'eventName');
        const message = params.find(p => p.name === 'message');
        if (!eventName || !message) {
            throw new Error('eventName and message are required');
        }
        const task = scheduler.registerEventTask(eventName.value, message.value);
        return { status: 'success', task };
    }

    async addEventToolTask(params) {
        const eventName = params.find(p => p.name === 'eventName');
        const toolName = params.find(p => p.name === 'toolName');
        const action = params.find(p => p.name === 'action');
        const paramStr = params.find(p => p.name === 'parameters');
        if (!eventName || !toolName || !action) {
            throw new Error('eventName, toolName and action are required');
        }
        let parsedParams = [];
        if (paramStr && paramStr.value) {
            try {
                parsedParams = JSON.parse(paramStr.value);
            } catch (e) {
                logger.error('SchedulerTool', 'Parameter parse error', { error: e.message });
            }
        }
        const task = scheduler.registerEventToolTask(eventName.value, toolName.value, action.value, parsedParams);
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

    async listEvents() {
        const events = scheduler.getSupportedEvents();
        return { status: 'success', events };
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
                case 'addToolTask':
                    return await this.addToolTask(parsed);
                case 'addEventTask':
                    return await this.addEventTask(parsed);
                case 'addEventToolTask':
                    return await this.addEventToolTask(parsed);
                case 'removeTask':
                    return await this.removeTask(parsed);
                case 'listTasks':
                    return await this.listTasks();
                case 'viewTasks':
                    return await this.viewTasks();
                case 'listEvents':
                    return await this.listEvents();
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

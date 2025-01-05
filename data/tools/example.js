class HelloWorldTool {
    constructor() {
        this.name = 'helloWorld';
        this.description = 'A simple example tool that demonstrates the tool structure';
    }

    async initialize() {
        // No initialization needed for this example
        console.log('Hello World Tool initialized');
    }

    async execute(action, params) {
        console.log('HelloWorld executing:', { action, params });
        try {
            switch (action) {
                case 'greet':
                    return await this.greet(params.name);
                case 'farewell':
                    return await this.farewell(params.name);
                default:
                    const error = new Error(`Unknown action: ${action}`);
                    console.error('Invalid action error:', {
                        error: error.message,
                        stack: error.stack,
                        action,
                        params
                    });
                    return {
                        status: 'error',
                        error: error.message,
                        stack: error.stack,
                        action,
                        params
                    };
            }
        } catch (error) {
            console.error('HelloWorld tool error:', {
                error: error.message,
                stack: error.stack,
                action,
                params
            });
            return {
                status: 'error',
                error: error.message,
                stack: error.stack,
                action,
                params
            };
        }
    }

    async greet(name = 'World') {
        return {
            status: 'success',
            message: `Hello, ${name}!`,
            timestamp: new Date().toISOString()
        };
    }

    async farewell(name = 'World') {
        return {
            status: 'success',
            message: `Goodbye, ${name}!`,
            timestamp: new Date().toISOString()
        };
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'greet',
                    description: 'Send a greeting to someone',
                    parameters: [{
                        name: 'name',
                        description: 'Name of the person to greet (defaults to "World")',
                        type: 'string',
                        required: false
                    }]
                },
                {
                    name: 'farewell',
                    description: 'Send a farewell to someone',
                    parameters: [{
                        name: 'name',
                        description: 'Name of the person to bid farewell (defaults to "World")',
                        type: 'string',
                        required: false
                    }]
                }
            ]
        };
    }
}

module.exports = new HelloWorldTool();
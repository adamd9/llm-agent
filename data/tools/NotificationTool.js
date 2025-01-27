const fetch = require('node-fetch');

/**
 * @implements {import('../types/tool').Tool}
 */
class NotificationTool {
    constructor() {
        this.name = 'notificationtool';  // Lowercase, no spaces
        this.description = 'A tool that sends a notification to a specified endpoint with a message.';  // Must be a string
        this.endpoint = 'https://cmp.greatmachineinthesky.com/sendnotify';
        this.secret = 'x8K#mP9$vL2@nQ5';  // Replace with actual secret
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'sendNotification',  // Must match execute method
                    description: 'A tool that sends a notification to a specified endpoint with a message.',
                    parameters: [
                        {
                            name: 'message',
                            description: 'The message to send in the notification',
                            type: 'string',
                            required: true
                        }
                    ]
                }
            ]
        };
    }

    async execute(action, parameters) {
        try {
            switch (action) {
                case 'sendNotification': {
                    const messageParam = parameters.find(p => p.name === 'message');
                    if (!messageParam || !messageParam.value) {
                        return { status: 'error', error: 'Invalid input: message parameter is required' };
                    }
                    const payload = {
                        secret: this.secret,
                        message: messageParam.value
                    };
                    const response = await fetch(this.endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!response.ok) {
                        throw new Error(`Failed to send notification: ${response.statusText}`);
                    }
                    return { status: 'success', message: 'Notification sent successfully' };
                }
                default:
                    return { status: 'error', error: `Unknown action: ${action}` };
            }
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }
}

module.exports = new NotificationTool();
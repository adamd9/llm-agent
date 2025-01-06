const EventEmitter = require('events');

class SharedEventEmitter {
    constructor() {
        this.eventQueue = [];
        this.isProcessing = false;
        this.listeners = {}; // Store event listeners
    }

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback); // Add callback to the list of listeners
    }

    async emit(event, data) {
        this.eventQueue.push({ event, data });
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    async processQueue() {
        this.isProcessing = true;
        while (this.eventQueue.length > 0) {
            const { event, data } = this.eventQueue.shift();
            await this.handleEvent(event, data); // Ensure the event handling is awaited
        }
        this.isProcessing = false;
    }

    async handleEvent(event, data) {
        // Call all registered listeners for the event
        if (this.listeners[event]) {
            for (const listener of this.listeners[event]) {
                await listener(data); // Ensure each listener is awaited
            }
        }
    }
}

const sharedEventEmitter = new SharedEventEmitter();

module.exports = sharedEventEmitter;

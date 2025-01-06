const sharedEventEmitter = require('../eventEmitter');

describe('Shared Event Emitter', () => {
    test('should emit and listen for events', (done) => {
        const eventData = { key: 'value' };

        sharedEventEmitter.on('testEvent', (data) => {
            expect(data).toEqual(eventData);
            done();
        });

        await sharedEventEmitter.emit('testEvent', eventData);
    });
});

const logger = require('../logger');
const WebSocket = require('ws');

describe('Logger', () => {
    let mockWs;
    let consoleSpy;

    beforeEach(() => {
        mockWs = {
            readyState: WebSocket.OPEN,
            send: jest.fn()
        };
        consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        logger.setWSConnections(new Map([['test-session', mockWs]]));
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    test('logs messages with different levels', () => {
        const testData = { key: 'value' };
        
        logger.error('TestContext', 'Error message', testData);
        logger.warn('TestContext', 'Warning message', testData);
        logger.info('TestContext', 'Info message', testData);
        logger.debug('TestContext', 'Debug message', testData);

        expect(consoleSpy).toHaveBeenCalledTimes(4);
        expect(mockWs.send).toHaveBeenCalledTimes(4);

        // Verify WebSocket messages
        const calls = mockWs.send.mock.calls;
        const levels = ['error', 'warn', 'info', 'debug'];
        
        calls.forEach((call, index) => {
            const message = JSON.parse(call[0]);
            expect(message.type).toBe('log');
            expect(message.data.level).toBe(levels[index]);
            expect(message.data.context).toBe('TestContext');
            expect(message.data.data).toEqual(testData);
            expect(message.data.timestamp).toBeDefined();
            expect(message.data.caller).toBeDefined();
        });
    });

    test('formats data objects correctly', () => {
        const complexData = {
            nested: {
                array: [1, 2, 3],
                string: 'test'
            }
        };

        logger.info('TestContext', 'Complex data test', complexData);
        
        expect(consoleSpy).toHaveBeenCalled();
        const wsMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(wsMessage.data.data).toEqual(complexData);
    });

    test('includes caller information', () => {
        logger.debug('TestContext', 'Test message');
        
        const wsMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(wsMessage.data.caller).toMatchObject({
            function: expect.any(String),
            file: expect.any(String),
            line: expect.any(String),
            column: expect.any(String)
        });
    });
});

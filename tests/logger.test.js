const logger = require('../src/logger');
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

    test('handles object data correctly', () => {
        const testData = { 
            key: 'value',
            nested: {
                array: [1, 2, 3],
                string: 'test'
            }
        };
        
        logger.debug('TestContext', 'Test message', testData);

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        expect(mockWs.send).toHaveBeenCalledTimes(1);

        const wsMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(wsMessage.type).toBe('debug');
        expect(wsMessage.data.context).toBe('TestContext');
        expect(wsMessage.data.message).toBe('Test message');
        expect(wsMessage.data.data).toEqual(testData);
        expect(wsMessage.data.timestamp).toBeDefined();
    });

    test('handles object passed as message', () => {
        const testObject = { 
            status: 'success',
            result: {
                value: 42
            }
        };
        
        logger.debug('TestContext', testObject);

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        expect(mockWs.send).toHaveBeenCalledTimes(1);

        const wsMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(wsMessage.type).toBe('debug');
        expect(wsMessage.data.context).toBe('TestContext');
        expect(wsMessage.data.message).toBe('');
        expect(wsMessage.data.data).toEqual(testObject);
        expect(wsMessage.data.timestamp).toBeDefined();
    });
});

const logger = require('../src/logger');

describe('Logger', () => {
    let mockWs;
    let mockConnections;

    beforeEach(() => {
        mockWs = {
            send: jest.fn(),
            readyState: 1 // WebSocket.OPEN
        };
        mockConnections = new Map([['test-session', mockWs]]);
        logger.setWSConnections(mockConnections);
    });

    test('handles object data correctly', () => {
        const testData = { key: 'value' };
        logger.debug('test', 'message', testData);
        
        expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"data":{"key":"value"}'));
    });

    test('handles object passed as message', () => {
        const testObj = { key: 'value' };
        logger.debug('test', testObj);
        
        expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"data":{"key":"value"}'));
    });

    test('sends response to chat window', () => {
        logger.response('test message');
        
        expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"response":"test message"'));
    });

    test('formats markdown response correctly', () => {
        const markdown = '# Test\n- Item 1\n- Item 2';
        logger.markdown(markdown);
        
        const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(sent.data.format).toBe('markdown');
        expect(sent.data.response).toBe(markdown);
    });

    test('formats code response correctly', () => {
        const code = 'const x = 1;';
        logger.code(code, 'javascript');
        
        const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(sent.data.format).toBe('code');
        expect(sent.data.language).toBe('javascript');
        expect(sent.data.response).toBe(code);
    });

    test('includes metadata in formatted responses', () => {
        const metadata = { timestamp: '2025-01-05' };
        logger.markdown('test', metadata);
        
        const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(sent.data.metadata).toEqual(metadata);
    });
});

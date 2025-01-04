const WebSocket = require('ws');
const http = require('http');
const express = require('express');

// Mock ego module before requiring app
const mockEgo = {
    processMessage: jest.fn().mockImplementation(async (msg) => ({
        type: 'conversation',
        response: 'Test response'
    }))
};

jest.mock('../src/ego', () => {
    return jest.fn().mockImplementation(() => mockEgo);
});

// Mock coordinator module
jest.mock('../src/coordinator', () => ({
    coordinator: jest.fn().mockImplementation(async (msg) => ({
        status: 'success',
        response: 'Task response',
        context: msg.context,
        plan: 'Test plan',
        results: []
    }))
}));

describe('WebSocket Chat', () => {
    let ws;
    let server;
    let wss;
    let app;
    let port;

    beforeEach((done) => {
        // Create fresh instances for each test
        app = express();
        app.use(express.json());
        
        // Store sessions in memory
        const sessions = new Map();
        const wsConnections = new Map();
        
        server = http.createServer(app);
        wss = new WebSocket.Server({ server });

        // WebSocket connection handler
        wss.on('connection', (ws) => {
            const sessionId = 'test-session-id';
            wsConnections.set(sessionId, ws);

            // Send session ID immediately
            ws.send(JSON.stringify({ type: 'session', sessionId }));

            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    const response = await mockEgo.processMessage(data.message);
                    
                    // Send response
                    ws.send(JSON.stringify({
                        type: 'response',
                        data: response
                    }));

                    // Update session history
                    let history = sessions.get(sessionId) || [];
                    history = [
                        ...history,
                        { role: 'user', content: data.message },
                        { role: 'assistant', content: response.response }
                    ];
                    sessions.set(sessionId, history);
                } catch (error) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: 'Internal server error',
                        details: {
                            message: error.message,
                            timestamp: new Date().toISOString()
                        }
                    }));
                }
            });
        });

        // Session history endpoint
        app.get('/chat/:sessionId/history', (req, res) => {
            const { sessionId } = req.params;
            const history = sessions.get(sessionId) || [];
            res.json(history);
        });

        // Start server
        server.listen(0, () => {
            port = server.address().port;
            ws = new WebSocket(`ws://localhost:${port}`);
            ws.on('open', done);
            ws.on('error', done);
        });
    });

    afterEach((done) => {
        const closeServer = () => {
            if (server) {
                server.close(done);
            } else {
                done();
            }
        };

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.on('close', closeServer);
            ws.close();
        } else {
            closeServer();
        }
    });

    it('should receive session ID on connection', (done) => {
        const newWs = new WebSocket(`ws://localhost:${port}`);
        
        newWs.on('message', (data) => {
            const message = JSON.parse(data);
            if (message.type === 'session') {
                expect(message.sessionId).toBe('test-session-id');
                newWs.close();
                done();
            }
        });
    });

    it('should handle chat messages and receive responses', (done) => {
        let receivedResponse = false;
        
        ws.on('message', (data) => {
            const message = JSON.parse(data);
            if (!receivedResponse && message.type === 'response') {
                receivedResponse = true;
                expect(message.data.type).toBe('conversation');
                expect(message.data.response).toBe('Test response');
                done();
            }
        });

        ws.send(JSON.stringify({ message: 'Test message' }));
    });

    it('should handle errors gracefully', (done) => {
        mockEgo.processMessage.mockImplementationOnce(() => {
            throw new Error('Test error');
        });

        let receivedError = false;
        ws.on('message', (data) => {
            const response = JSON.parse(data);
            if (!receivedError && response.type === 'error') {
                receivedError = true;
                expect(response.error).toBe('Internal server error');
                expect(response.details.message).toBe('Test error');
                expect(response.details.timestamp).toBeDefined();
                done();
            }
        });

        ws.send(JSON.stringify({ message: 'Test message' }));
    });

    it('should maintain session history', async () => {
        // Send test message
        ws.send(JSON.stringify({ 
            message: 'Test message 1', 
            sessionId: 'test-session-id' 
        }));

        // Wait for response
        await new Promise(resolve => {
            let receivedResponse = false;
            ws.on('message', (data) => {
                const message = JSON.parse(data);
                if (!receivedResponse && message.type === 'response') {
                    receivedResponse = true;
                    resolve();
                }
            });
        });

        // Get session history
        const response = await fetch(`http://localhost:${port}/chat/test-session-id/history`);
        const history = await response.json();

        expect(Array.isArray(history)).toBe(true);
        expect(history.length).toBe(2);
        expect(history[0].role).toBe('user');
        expect(history[0].content).toBe('Test message 1');
        expect(history[1].role).toBe('assistant');
        expect(history[1].content).toBe('Test response');
    });

    it('should handle reconnection', (done) => {
        const newWs = new WebSocket(`ws://localhost:${port}`);
        let receivedSession = false;
        
        newWs.on('message', (data) => {
            const message = JSON.parse(data);
            if (!receivedSession && message.type === 'session') {
                receivedSession = true;
                expect(message.sessionId).toBe('test-session-id');
                newWs.close();
                done();
            }
        });
    });

    // test('Server starts successfully', async () => {
    //     const Ego = require('../src/ego');
    //     const ego = new Ego();
    //     await ego.initialize();
    //     const server = require('../src/index'); // Adjust the path as necessary
    //     const response = await fetch('http://localhost:3000'); // Adjust the port if necessary
    //     expect(response.status).toBe(200);
    // });
});

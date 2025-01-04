const request = require('supertest');

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

const app = require('../src/index');

describe('API Endpoints', () => {
    beforeEach(() => {
        // Reset mock implementation before each test
        mockEgo.processMessage.mockClear();
        mockEgo.processMessage.mockImplementation(async (msg) => ({
            type: 'conversation',
            response: 'Test response'
        }));
    });

    it('should handle valid POST request to /chat', async () => {
        const response = await request(app)
            .post('/chat')
            .send({ message: 'Test instruction' });
        
        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe('Test response');
        expect(response.body.sessionId).toBeDefined();
    });

    it('should handle missing message', async () => {
        const response = await request(app)
            .post('/chat')
            .send({});
        
        expect(response.statusCode).toBe(400);
        expect(response.body.error).toBe('Message is required');
    });

    it('should handle server errors', async () => {
        mockEgo.processMessage.mockImplementationOnce(() => {
            throw new Error('Test error');
        });

        const response = await request(app)
            .post('/chat')
            .send({ message: 'Test instruction' });
        
        expect(response.statusCode).toBe(500);
        expect(response.body.error).toBe('Internal server error');
    });

    it('should maintain session across requests', async () => {
        // First request - should create new session
        const response1 = await request(app)
            .post('/chat')
            .send({ message: 'First message' });
        
        expect(response1.statusCode).toBe(200);
        const sessionId = response1.body.sessionId;
        expect(sessionId).toBeDefined();

        // Second request - should use same session
        const response2 = await request(app)
            .post('/chat')
            .set('session-id', sessionId)
            .send({ message: 'Second message' });
        
        expect(response2.statusCode).toBe(200);
        expect(response2.body.sessionId).toBe(sessionId);
    });

    it('should handle task messages', async () => {
        mockEgo.processMessage.mockImplementationOnce(async () => ({
            type: 'task',
            response: 'Planning task...',
            enriched_message: {
                original_message: 'Test task',
                context: { test: 'context' }
            }
        }));

        const response = await request(app)
            .post('/chat')
            .send({ message: 'Test task' });
        
        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe('Task response');
        expect(response.body.sessionId).toBeDefined();
    });

    it('should retrieve session history', async () => {
        const response = await request(app)
            .get('/chat/test-session/history');
        
        expect(response.statusCode).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
    });
});

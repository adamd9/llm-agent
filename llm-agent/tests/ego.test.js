const Ego = require('../src/ego');
const { OpenAI } = require('openai');
const { planner } = require('../src/planner');
const { coordinator } = require('../src/coordinator');

// Mock dependencies
jest.mock('openai');
jest.mock('../src/planner');
jest.mock('../src/coordinator');

describe('Ego Service', () => {
    let ego;
    let mockOpenAI;
    let originalEnv;

    beforeEach(() => {
        // Save original environment
        originalEnv = process.env;
        process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key' };

        // Create a fresh mock for each test
        mockOpenAI = {
            chat: {
                completions: {
                    create: jest.fn()
                }
            }
        };

        // Reset all mocks
        jest.clearAllMocks();

        // Default planner response for conversation
        planner.mockResolvedValue({
            status: 'success',
            requiresTools: false,
            explanation: 'This is a conversation',
            context: 'This is a conversation context'
        });

        ego = new Ego('test-identity', ['conversation', 'tasks'], mockOpenAI);
    });

    afterEach(() => {
        // Restore original environment
        process.env = originalEnv;
    });

    it('should handle conversation messages', async () => {
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: 'Hello! How can I help you?'
                }
            }]
        });

        const result = await ego.processMessage('hello');
        expect(result.type).toBe('conversation');
        expect(result.response).toBe('Hello! How can I help you?');
    });

    it('should detect and handle task messages', async () => {
        // Mock planner to indicate task
        planner.mockResolvedValueOnce({
            status: 'success',
            requiresTools: true,
            explanation: 'This requires tools',
            plan: JSON.stringify([{
                tool: 'fileSystem',
                action: 'list',
                parameters: {}
            }])
        });

        // Mock coordinator response
        coordinator.mockResolvedValueOnce({
            status: 'success',
            response: 'Files listed successfully'
        });

        const result = await ego.processMessage('list files');
        expect(result.type).toBe('task');
        expect(result.response).toBe('Files listed successfully');
    });

    it('should handle session history in conversations', async () => {
        // Mock planner to indicate conversation
        planner.mockResolvedValueOnce({
            status: 'success',
            requiresTools: false,
            explanation: 'This is a conversation',
            context: 'This is a conversation context'
        });

        // Mock OpenAI response
        const mockResponse = 'I remember our previous conversation';
        const mockCreate = jest.fn().mockResolvedValueOnce({
            choices: [{
                message: {
                    content: mockResponse
                }
            }]
        });

        // Set up OpenAI mock
        mockOpenAI.chat.completions.create = mockCreate;

        const sessionHistory = [
            { role: 'user', content: 'previous message' },
            { role: 'assistant', content: 'previous response' }
        ];

        // Debug log the mocks
        console.log('OpenAI mock:', {
            create: mockOpenAI.chat.completions.create,
            mockResponse
        });

        const result = await ego.processMessage('hello', sessionHistory);
        
        // Debug log the result
        console.log('Result:', result);
        
        expect(result.type).toBe('conversation');
        expect(result.response).toBe(mockResponse);

        // Verify messages array contains system prompt and history
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ role: 'system' }),
                expect.objectContaining({ role: 'user', content: 'previous message' }),
                expect.objectContaining({ role: 'assistant', content: 'previous response' }),
                expect.objectContaining({ role: 'user', content: 'hello' })
            ])
        );
    });

    it('should handle API errors gracefully', async () => {
        planner.mockRejectedValueOnce(new Error('API Error'));

        const result = await ego.processMessage('hello');
        expect(result.type).toBe('error');
        expect(result.error).toEqual({ message: 'API Error' });
    });

    it('should handle planner errors', async () => {
        planner.mockResolvedValueOnce({
            status: 'error',
            error: 'Planning failed'
        });

        const result = await ego.processMessage('list files');
        expect(result.type).toBe('error');
        expect(result.error).toEqual({ message: 'Planning failed' });
    });

    it('should handle coordinator errors', async () => {
        planner.mockResolvedValueOnce({
            status: 'success',
            requiresTools: true,
            plan: JSON.stringify([{ tool: 'test', action: 'test' }])
        });

        coordinator.mockResolvedValueOnce({
            status: 'error',
            error: 'Execution failed',
            response: 'Execution failed'
        });

        const result = await ego.processMessage('list files');
        expect(result.type).toBe('task');
        expect(result.response).toBe('Execution failed');
    });
});

const Ego = require('../src/ego');
const { OpenAI } = require('openai');
const { planner } = require('../src/planner');
const { coordinator } = require('../src/coordinator');
const personalityManager = require('../src/personalities');

// Mock dependencies
jest.mock('openai');
jest.mock('../src/planner');
jest.mock('../src/coordinator');
jest.mock('../src/personalities', () => ({
    loadPersonalities: jest.fn(),
    getPersonality: jest.fn(),
    getDefaultPersonality: jest.fn()
}));

describe('Ego Service', () => {
    let ego;
    let mockOpenAI;
    let originalEnv;

    beforeEach(async () => {
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

        // Mock default personality
        personalityManager.getDefaultPersonality.mockReturnValue({
            name: 'cascade',
            prompt: 'You are a test assistant'
        });
        personalityManager.loadPersonalities.mockResolvedValue([]);

        ego = new Ego(null, mockOpenAI);
        await ego.initialize();
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
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: mockResponse
                }
            }]
        });

        const result = await ego.processMessage('hello again', [{ role: 'user', content: 'previous message' }]);
        expect(result.type).toBe('conversation');
        expect(result.response).toBe(mockResponse);
    });

    it('should initialize with default personality', async () => {
        const defaultEgo = new Ego();
        await defaultEgo.initialize();
        
        const defaultPersonality = personalityManager.getDefaultPersonality();
        expect(defaultEgo.identity).toBe(defaultPersonality.name);
        expect(defaultEgo.capabilities).toEqual(['conversation', 'tasks']);
        expect(defaultEgo.personality).toEqual(defaultPersonality);
    });

    it('should allow changing personality', async () => {
        const defaultEgo = new Ego();
        await defaultEgo.initialize();
        
        // Mock a new personality
        const customPersonality = {
            name: 'Custom',
            prompt: 'A custom personality'
        };
        personalityManager.getPersonality.mockReturnValue(customPersonality);
        
        await defaultEgo.setPersonality('Custom');
        expect(defaultEgo.personality).toEqual(customPersonality);
        // Identity should not change if it was set in constructor
        expect(defaultEgo.identity).toBe('cascade');
        expect(defaultEgo.capabilities).toEqual(['conversation', 'tasks']);
    });

    it('should throw error when setting invalid personality', async () => {
        const defaultEgo = new Ego();
        await defaultEgo.initialize();
        
        personalityManager.getPersonality.mockReturnValue(null);
        
        await expect(defaultEgo.setPersonality('Invalid')).rejects.toThrow('Personality Invalid not found');
    });
});

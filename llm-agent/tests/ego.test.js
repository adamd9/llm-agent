const Ego = require('../src/ego');
const { OpenAI } = require('openai');

// Mock OpenAI client
const mockCreate = jest.fn();
const mockOpenAI = {
    chat: {
        completions: {
            create: mockCreate
        }
    }
};

jest.mock('openai', () => ({
    OpenAI: jest.fn().mockImplementation(() => mockOpenAI)
}));

// Mock coordinator
jest.mock('../src/coordinator', () => ({
    coordinator: jest.fn().mockResolvedValue({
        response: 'I will help you create a file.'
    })
}));

// Mock tools
jest.mock('../src/tools', () => ({
    loadTools: jest.fn().mockResolvedValue([
        { name: 'fileSystem', description: 'File system operations' }
    ])
}));

// Mock planner
jest.mock('../src/planner', () => ({
    simplifiedPlanner: jest.fn().mockResolvedValue({
        status: 'success',
        plan: JSON.stringify({
            steps: [{
                tool: 'fileSystem',
                action: 'list',
                parameters: { path: '/usr/src/app' }
            }]
        })
    })
}));

describe('Ego Service', () => {
    let ego;

    beforeEach(() => {
        ego = new Ego('test', ['conversation']);
        mockCreate.mockClear();
    });

    it('should handle conversation messages', async () => {
        mockCreate.mockResolvedValue({
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
        mockCreate.mockResolvedValue({
            choices: [{
                message: {
                    content: 'I will help you list files.'
                }
            }]
        });

        const result = await ego.processMessage('list files');
        expect(result.type).toBe('task');
        expect(result.response).toBe('I will help you create a file.');
    });

    it('should handle session history in conversations', async () => {
        const mockResponse = 'I remember our previous conversation';
        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: mockResponse
                }
            }]
        });

        const sessionHistory = [
            { role: 'user', content: 'previous message' },
            { role: 'assistant', content: 'previous response' }
        ];

        const result = await ego.processMessage('hello', sessionHistory);
        expect(result.type).toBe('conversation');
        expect(result.response).toBe(mockResponse);
    });

    it('should handle API errors gracefully', async () => {
        mockCreate.mockRejectedValueOnce(new Error('API Error'));

        const result = await ego.processMessage('how are you');
        expect(result.type).toBe('error');
        expect(result.error).toBeDefined();
        expect(result.error.message).toBe('API Error');
    });

    describe('Task Detection', () => {
        it('should detect file-related tasks', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'I will help you list files.'
                    }
                }]
            });

            const tasks = [
                'list files',
                'show me the files',
                'what files are in the directory'
            ];

            for (const task of tasks) {
                const result = await ego.processMessage(task);
                expect(result.type).toBe('task');
            }
        });

        it('should not detect simple conversations as tasks', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Just chatting!'
                    }
                }]
            });

            const result = await ego.processMessage('how are you?');
            expect(result.type).toBe('conversation');
        });
    });
});

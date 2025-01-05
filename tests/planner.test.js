const { planner } = require('../src/planner');
const { OpenAI } = require('openai');
const toolManager = require('../src/tools');

// Mock OpenAI
jest.mock('openai');

// Mock tools
jest.mock('../src/tools', () => ({
    loadTools: jest.fn().mockResolvedValue([
        {
            name: 'fileSystem',
            description: 'Tool for file operations',
            execute: jest.fn(),
            getCapabilities: () => ({
                name: 'fileSystem',
                description: 'Tool for file operations',
                actions: [
                    {
                        name: 'list',
                        description: 'List files in a directory',
                        parameters: [{
                            name: 'path',
                            description: 'Path to list',
                            type: 'string',
                            required: true
                        }]
                    }
                ]
            })
        }
    ])
}));

describe('Planner Service', () => {
    let mockOpenAI;

    beforeEach(() => {
        // Mock OpenAI client
        mockOpenAI = {
            chat: {
                completions: {
                    create: jest.fn()
                }
            }
        };

        // Reset all mocks between tests
        jest.clearAllMocks();
    });

    it('should analyze if task requires tools and return a plan', async () => {
        // Mock responses
        mockOpenAI.chat.completions.create
            .mockResolvedValueOnce({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            requiresTools: true,
                            explanation: "This task requires file system tools"
                        })
                    }
                }]
            })
            .mockResolvedValueOnce({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            steps: [{
                                tool: 'fileSystem',
                                action: 'list',
                                parameters: { path: '/test' },
                                description: 'List files in test directory'
                            }]
                        })
                    }
                }]
            });

        const enrichedMessage = {
            original_message: 'list files',
            context: {
                tools: [{
                    name: 'fileSystem',
                    description: 'Tool for file operations'
                }]
            }
        };

        const result = await planner(enrichedMessage, mockOpenAI);
        expect(result.status).toBe('success');
        expect(result.requiresTools).toBe(true);
        expect(result.explanation).toBe('This task requires file system tools');
        expect(result.plan).toBeDefined();
        
        const plan = JSON.parse(result.plan);
        expect(Array.isArray(plan)).toBe(true);
        expect(plan[0].tool).toBe('fileSystem');

        // Verify proper API usage
        expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
    });

    it('should handle conversation messages without tools', async () => {
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        requiresTools: false,
                        explanation: "This is a simple conversation"
                    })
                }
            }]
        });

        const enrichedMessage = {
            original_message: 'hello',
            context: {
                tools: []
            }
        };

        const result = await planner(enrichedMessage, mockOpenAI);
        expect(result.status).toBe('success');
        expect(result.requiresTools).toBe(false);
        expect(result.explanation).toBe('This is a simple conversation');
        expect(result.plan).toBeUndefined();

        // Verify API was called correctly
        expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully', async () => {
        mockOpenAI.chat.completions.create.mockRejectedValueOnce(
            new Error('API error')
        );

        const enrichedMessage = {
            original_message: 'list files',
            context: {
                tools: []
            }
        };

        const result = await planner(enrichedMessage, mockOpenAI);
        expect(result.status).toBe('error');
        expect(result.error).toBeDefined();
    });

    it('should handle invalid LLM responses', async () => {
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: 'Not a valid JSON'
                }
            }]
        });

        const enrichedMessage = {
            original_message: 'list files',
            context: {
                tools: []
            }
        };

        const result = await planner(enrichedMessage, mockOpenAI);
        expect(result.status).toBe('error');
        expect(result.error).toBe('Invalid task analysis format');
    });
});

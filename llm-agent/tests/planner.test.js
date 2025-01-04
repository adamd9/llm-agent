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
        mockOpenAI = {
            chat: {
                completions: {
                    create: jest.fn()
                }
            }
        };

        // Reset all mocks
        jest.clearAllMocks();

        // Mock OpenAI constructor
        OpenAI.mockImplementation(() => mockOpenAI);

        // Set environment variable
        process.env.OPENAI_API_KEY = 'test-key';
    });

    it('should analyze if task requires tools and return a plan', async () => {
        // First call returns task analysis
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        requiresTools: true,
                        explanation: "This task requires file system tools"
                    })
                }
            }]
        });

        // Second call returns plan
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify([{
                        tool: 'fileSystem',
                        action: 'list',
                        parameters: { path: '/test' },
                        description: 'List files in test directory'
                    }])
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

        const result = await planner(enrichedMessage);
        expect(result.status).toBe('success');
        expect(result.requiresTools).toBe(true);
        expect(result.explanation).toBeDefined();
        expect(result.plan).toBeDefined();
        
        const plan = JSON.parse(result.plan);
        expect(Array.isArray(plan)).toBe(true);
        expect(plan[0].tool).toBe('fileSystem');
    });

    it('should handle conversation messages without tools', async () => {
        // Mock task analysis response
        const mockResponse = {
            requiresTools: false,
            explanation: "This is a simple conversation"
        };
        
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify(mockResponse)
                }
            }]
        });

        const enrichedMessage = {
            original_message: 'hello how are you',
            context: {
                tools: [{
                    name: 'fileSystem',
                    description: 'Tool for file operations'
                }]
            }
        };

        const result = await planner(enrichedMessage, mockOpenAI);
        expect(result.status).toBe('success');
        expect(result.requiresTools).toBe(false);
        expect(result.explanation).toBeDefined();
        expect(result.plan).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
        mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

        const enrichedMessage = {
            original_message: 'list files',
            context: {
                tools: [{
                    name: 'fileSystem',
                    description: 'Tool for file operations'
                }]
            }
        };

        const result = await planner(enrichedMessage);
        expect(result.status).toBe('error');
        expect(result.error).toBeDefined();
    });

    it('should handle invalid LLM responses', async () => {
        // Mock invalid JSON response
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: 'Invalid JSON'
                }
            }]
        });

        const enrichedMessage = {
            original_message: 'list files',
            context: {
                tools: [{
                    name: 'fileSystem',
                    description: 'Tool for file operations',
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
                }]
            }
        };

        const result = await planner(enrichedMessage, mockOpenAI);
        expect(result.status).toBe('error');
        expect(result.error).toBe('Invalid task analysis format');
    });
});

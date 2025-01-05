const { evaluator } = require('../src/evaluator');

// Mock OpenAI
jest.mock('../src/openaiClient', () => ({
    getOpenAIClient: jest.fn().mockReturnValue({
        chat: {
            completions: {
                create: jest.fn()
            }
        }
    })
}));

describe('Evaluator Service', () => {
    let mockOpenAI;

    beforeEach(() => {
        jest.clearAllMocks();
        mockOpenAI = require('../src/openaiClient').getOpenAIClient();
    });

    it('should evaluate task execution successfully', async () => {
        // Mock successful OpenAI response
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        score: 90,
                        analysis: 'Task executed well',
                        recommendations: []
                    })
                }
            }]
        });

        const result = await evaluator({
            originalRequest: 'list files',
            executionResult: {
                status: 'success',
                response: 'Files listed successfully'
            },
            plan: [{ tool: 'fileSystem', action: 'list' }]
        });

        expect(result.score).toBe(90);
        expect(result.analysis).toBe('Task executed well');
        expect(result.recommendations).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
        // Mock API error
        mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('API Error'));

        const result = await evaluator({
            originalRequest: 'list files',
            executionResult: {
                status: 'success',
                response: 'Files listed successfully'
            },
            plan: [{ tool: 'fileSystem', action: 'list' }]
        });

        expect(result.score).toBe(0);
        expect(result.analysis).toContain('Error evaluating');
        expect(result.recommendations).toEqual(['Retry the operation']);
    });

    it('should handle invalid API responses', async () => {
        // Mock invalid response format
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: 'Not JSON'
                }
            }]
        });

        const result = await evaluator({
            originalRequest: 'list files',
            executionResult: {
                status: 'success',
                response: 'Files listed successfully'
            },
            plan: [{ tool: 'fileSystem', action: 'list' }]
        });

        expect(result.score).toBe(0);
        expect(result.analysis).toContain('Invalid evaluation');
        expect(result.recommendations).toEqual(['Retry with different approach']);
    });
});

const Ego = require('../src/ego');

// Mock dependencies
jest.mock('../src/openaiClient', () => ({
    getOpenAIClient: jest.fn().mockReturnValue({
        chat: {
            completions: {
                create: jest.fn()
            }
        }
    })
}));

jest.mock('../src/coordinator', () => ({
    coordinator: jest.fn()
}));

jest.mock('../src/planner', () => ({
    planner: jest.fn()
}));

jest.mock('../src/evaluator', () => ({
    evaluator: jest.fn()
}));

jest.mock('../src/personalities', () => ({
    loadPersonalities: jest.fn().mockResolvedValue(),
    getDefaultPersonality: jest.fn().mockReturnValue({
        name: 'default',
        prompt: 'default personality'
    }),
    getPersonality: jest.fn().mockImplementation(name => {
        if (name === 'invalid') return null;
        return { name, prompt: `${name} personality` };
    })
}));

describe('Ego Service', () => {
    let ego;
    let mockPlanner;
    let mockCoordinator;
    let mockEvaluator;

    beforeEach(() => {
        jest.clearAllMocks();
        ego = new Ego('test-identity');
        mockPlanner = require('../src/planner').planner;
        mockCoordinator = require('../src/coordinator').coordinator;
        mockEvaluator = require('../src/evaluator').evaluator;
    });

    describe('Basic Functionality', () => {
        it('should handle conversation messages', async () => {
            // Mock planner to indicate this is a conversation
            mockPlanner.mockResolvedValueOnce({
                requiresTools: false,
                response: 'Hello! How can I help you?'
            });

            const result = await ego.processMessage('hello');
            expect(result.type).toBe('conversation');
            expect(result.response).toBe('Hello! How can I help you?');
            expect(mockEvaluator).not.toHaveBeenCalled();
        });

        it('should detect and handle task messages', async () => {
            // Mock planner to indicate this is a task
            mockPlanner.mockResolvedValueOnce({
                status: 'success',
                requiresTools: true,
                plan: JSON.stringify([{ tool: 'fileSystem', action: 'list' }])
            });

            // Mock successful execution
            mockCoordinator.mockResolvedValueOnce({
                status: 'success',
                response: 'Files listed successfully'
            });

            // Mock successful evaluation
            mockEvaluator.mockResolvedValueOnce({
                score: 90,
                analysis: 'Task completed successfully',
                recommendations: []
            });

            const result = await ego.processMessage('list files');
            expect(result.type).toBe('task');
            expect(result.response).toBe('Files listed successfully');
            expect(result.evaluation.score).toBe(90);
            expect(mockEvaluator).toHaveBeenCalledTimes(1);
        });

        it('should handle session history in conversations', async () => {
            // Mock planner to indicate this is a conversation
            mockPlanner.mockResolvedValueOnce({
                requiresTools: false,
                response: 'Hello again!'
            });

            const result = await ego.processMessage('hello again', [{ role: 'user', content: 'previous message' }]);
            expect(result.type).toBe('conversation');
            expect(result.response).toBe('Hello again!');
            expect(mockEvaluator).not.toHaveBeenCalled();
        });

        it('should initialize with default personality', async () => {
            await ego.initialize();
            expect(ego.personality).toBeTruthy();
            expect(ego.personality.name).toBe('default');
        });

        it('should allow changing personality', async () => {
            await ego.setPersonality('friendly');
            expect(ego.personality.name).toBe('friendly');
        });

        it('should throw error when setting invalid personality', async () => {
            await expect(ego.setPersonality('invalid')).rejects.toThrow();
        });
    });

    describe('Task Execution and Evaluation', () => {
        it('should execute task and return result if evaluation score meets threshold', async () => {
            // Mock successful planning
            mockPlanner.mockResolvedValueOnce({
                status: 'success',
                requiresTools: true,
                plan: JSON.stringify([{ tool: 'test', action: 'test' }])
            });

            // Mock successful execution
            mockCoordinator.mockResolvedValueOnce({
                status: 'success',
                response: 'Task completed'
            });

            // Mock good evaluation
            mockEvaluator.mockResolvedValueOnce({
                score: 90,
                analysis: 'Good execution',
                recommendations: []
            });

            const result = await ego.processMessage('do something');
            
            expect(result.type).toBe('task');
            expect(result.evaluation.score).toBe(90);
            expect(mockPlanner).toHaveBeenCalledTimes(1);
            expect(mockCoordinator).toHaveBeenCalledTimes(1);
            expect(mockEvaluator).toHaveBeenCalledTimes(1);
        });

        it('should retry task execution when evaluation score is below threshold', async () => {
            // Mock successful planning for both attempts
            mockPlanner
                .mockResolvedValueOnce({
                    status: 'success',
                    requiresTools: true,
                    plan: JSON.stringify([{ tool: 'test', action: 'first' }])
                })
                .mockResolvedValueOnce({
                    status: 'success',
                    requiresTools: true,
                    plan: JSON.stringify([{ tool: 'test', action: 'second' }])
                });

            // Mock execution results
            mockCoordinator
                .mockResolvedValueOnce({
                    status: 'success',
                    response: 'First attempt'
                })
                .mockResolvedValueOnce({
                    status: 'success',
                    response: 'Second attempt'
                });

            // Mock evaluations - first poor, then good
            mockEvaluator
                .mockResolvedValueOnce({
                    score: 60,
                    analysis: 'Needs improvement',
                    recommendations: ['Try differently']
                })
                .mockResolvedValueOnce({
                    score: 95,
                    analysis: 'Much better',
                    recommendations: []
                });

            const result = await ego.processMessage('do something');
            
            // Should be an array with progress message and final result
            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(2);
            
            // Check progress message
            expect(result[0].type).toBe('progress');
            expect(result[0].response).toContain('60%');
            
            // Check final result
            expect(result[1].type).toBe('task');
            expect(result[1].evaluation.score).toBe(95);
            expect(result[1].response).toContain('after 2 attempts');
            
            // Verify multiple attempts were made
            expect(mockPlanner).toHaveBeenCalledTimes(2);
            expect(mockCoordinator).toHaveBeenCalledTimes(2);
            expect(mockEvaluator).toHaveBeenCalledTimes(2);
        });

        it('should handle conversation without evaluation', async () => {
            // Mock planner indicating this is just conversation
            mockPlanner.mockResolvedValueOnce({
                requiresTools: false,
                response: 'Just chatting'
            });

            const result = await ego.processMessage('hello');
            
            expect(result.type).toBe('conversation');
            expect(result.response).toBe('Just chatting');
            expect(mockEvaluator).not.toHaveBeenCalled();
        });

        it('should respect max retries limit', async () => {
            // Mock consistently low-scoring evaluations
            mockPlanner.mockResolvedValue({
                status: 'success',
                requiresTools: true,
                plan: JSON.stringify([{ tool: 'test', action: 'test' }])
            });

            mockCoordinator.mockResolvedValue({
                status: 'success',
                response: 'Attempt'
            });

            mockEvaluator.mockResolvedValue({
                score: 50,
                analysis: 'Not quite right',
                recommendations: ['Try again']
            });

            const result = await ego.processMessage('do something');
            
            // Should have multiple progress messages and a final result
            expect(Array.isArray(result)).toBe(true);
            
            // Count the number of attempts (progress messages + final result)
            expect(result.length).toBeLessThanOrEqual(6); // 5 attempts + 1 final
            expect(mockPlanner).toHaveBeenCalledTimes(5); // MAX_RETRIES
        });
    });
});

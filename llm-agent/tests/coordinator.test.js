const { coordinator } = require('../src/coordinator');
const { planner } = require('../src/planner');
const { executor } = require('../src/executor');

// Mock dependencies
jest.mock('../src/planner', () => ({
    planner: jest.fn()
}));

jest.mock('../src/executor', () => ({
    executor: jest.fn()
}));

describe('Coordinator Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should coordinate all services successfully', async () => {
        const mockPlan = {
            steps: [
                {
                    tool: "fileSystem",
                    description: "Read file contents",
                    parameters: {
                        path: "/test/file.txt",
                        operation: "read"
                    }
                }
            ]
        };

        // Mock successful responses
        planner.mockResolvedValue({
            status: 'success',
            plan: JSON.stringify(mockPlan)
        });

        executor.mockResolvedValue({
            status: 'success',
            results: [
                {
                    step: "Read file contents",
                    tool: "fileSystem",
                    status: 'success',
                    result: 'File contents here'
                }
            ]
        });

        const enrichedMessage = {
            original_message: 'Read the test file',
            context: {
                identity: { name: 'Test Agent' },
                capabilities: { tools: ['fileSystem'] }
            }
        };

        const result = await coordinator(enrichedMessage);

        expect(result.status).toBe('success');
        expect(result.response).toBeDefined();
        expect(result.context).toBeDefined();
        expect(result.plan).toBeDefined();
        expect(result.results).toBeDefined();
        
        expect(planner).toHaveBeenCalledWith(enrichedMessage);
        expect(executor).toHaveBeenCalledWith(JSON.stringify(mockPlan));
    });

    it('should handle planning errors', async () => {
        planner.mockResolvedValue({
            status: 'error',
            error: 'Planning failed'
        });

        const enrichedMessage = {
            original_message: 'Read the test file',
            context: {
                identity: { name: 'Test Agent' },
                capabilities: { tools: ['fileSystem'] }
            }
        };

        const result = await coordinator(enrichedMessage);

        expect(result.status).toBe('error');
        expect(result.error).toBe('Planning failed');
        expect(result.phase).toBe('planning');
    });

    it('should handle execution errors', async () => {
        const mockPlan = {
            steps: [
                {
                    tool: "fileSystem",
                    description: "Read file contents",
                    parameters: {
                        path: "/test/file.txt",
                        operation: "read"
                    }
                }
            ]
        };

        planner.mockResolvedValue({
            status: 'success',
            plan: JSON.stringify(mockPlan)
        });

        executor.mockResolvedValue({
            status: 'error',
            error: 'Execution failed'
        });

        const enrichedMessage = {
            original_message: 'Read the test file',
            context: {
                identity: { name: 'Test Agent' },
                capabilities: { tools: ['fileSystem'] }
            }
        };

        const result = await coordinator(enrichedMessage);

        expect(result.status).toBe('error');
        expect(result.error).toBe('Execution failed');
        expect(result.phase).toBe('execution');
        expect(result.plan).toBeDefined();
    });
});

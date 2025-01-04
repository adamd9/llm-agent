// Mock OpenAI before requiring the planner
const mockChatCompletion = jest.fn();

jest.mock('openai', () => ({
    OpenAI: jest.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: mockChatCompletion
            }
        }
    }))
}));

// Mock tools
jest.mock('../src/tools', () => ({
    loadTools: jest.fn().mockResolvedValue([
        { name: 'fileSystem', description: 'File system operations' }
    ])
}));

// Now require the planner after the mock is set up
const { planner } = require('../src/planner');

describe('Planner Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockChatCompletion.mockClear();
    });

    it('should return a success status and plan when given valid instruction', async () => {
        const enrichedMessage = {
            original_message: 'list files',
            context: { identity: 'test' }
        };

        const result = await planner(enrichedMessage);
        expect(result.status).toBe('success');
        expect(result.plan).toBeDefined();
        
        const plan = JSON.parse(result.plan);
        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].tool).toBe('fileSystem');
        expect(plan.steps[0].action).toBe('list');
    });

    it('should handle errors gracefully', async () => {
        const result = await planner(null);
        expect(result.status).toBe('error');
        expect(result.error).toBeDefined();
    });

    it('should handle invalid plan format', async () => {
        const result = await planner({
            original_message: 'invalid request',
            context: {}
        });
        expect(result.status).toBe('success');
        const plan = JSON.parse(result.plan);
        expect(Array.isArray(plan.steps)).toBe(true);
    });

    it('should handle invalid step format', async () => {
        const result = await planner({
            original_message: 'list files',
            context: {}
        });
        expect(result.status).toBe('success');
        const plan = JSON.parse(result.plan);
        expect(plan.steps.every(step => 
            step.description && 
            step.tool && 
            step.action && 
            step.parameters
        )).toBe(true);
    });
});

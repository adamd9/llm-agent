const { coordinator } = require('../src/coordinator');
const toolManager = require('../src/tools');
const logger = require('../src/logger');
const openaiClient = require('../src/openaiClient');

jest.mock('../src/tools', () => ({
    loadTools: jest.fn().mockResolvedValue([{
        name: 'test',
        execute: jest.fn().mockResolvedValue({
            status: 'success',
            data: { result: 'test' }
        })
    }])
}));

jest.mock('../src/logger', () => ({
    debug: jest.fn(),
    response: jest.fn(),
    markdown: jest.fn()
}));

jest.mock('../src/openaiClient', () => ({
    createCompletion: jest.fn()
}));

describe('Coordinator Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock successful LLM response
        openaiClient.createCompletion.mockResolvedValue({
            choices: [{
                text: '# Test Summary\n\n## Success\n- Step 1 completed'
            }]
        });
    });

    test('should coordinate execution of plan successfully', async () => {
        const mockSteps = [{
            tool: 'test',
            action: 'action',
            parameters: {}
        }];

        const enrichedMessage = {
            original_message: 'test message',
            plan: JSON.stringify(mockSteps)
        };

        const result = await coordinator(enrichedMessage);
        logger.debug('Test result:', result);

        expect(result.status).toBe('success');
        expect(result.results).toHaveLength(1);
        expect(logger.markdown).toHaveBeenCalled();
    });

    test('should handle missing plan', async () => {
        const result = await coordinator({
            original_message: 'test'
        });
        expect(result.status).toBe('error');
        expect(result.error).toBeDefined();
    });

    test('should handle invalid tool in plan', async () => {
        const mockSteps = [{
            tool: 'invalid',
            action: 'action',
            parameters: {}
        }];

        const enrichedMessage = {
            original_message: 'test message',
            plan: JSON.stringify(mockSteps)
        };

        const result = await coordinator(enrichedMessage);
        expect(result.status).toBe('error');
        expect(result.error).toBeDefined();
    });

    test('should handle tool execution errors', async () => {
        const mockSteps = [{
            tool: 'test',
            action: 'action',
            parameters: {}
        }];

        const enrichedMessage = {
            original_message: 'test message',
            plan: JSON.stringify(mockSteps)
        };

        // Mock tool execution error
        toolManager.loadTools.mockResolvedValueOnce([{
            name: 'test',
            execute: jest.fn().mockRejectedValue(new Error('Execution failed'))
        }]);

        const result = await coordinator(enrichedMessage);
        expect(result.status).toBe('error');
        expect(result.error).toBeDefined();
    });

    test('should handle invalid plan JSON', async () => {
        const result = await coordinator({
            original_message: 'test message',
            plan: 'invalid json'
        });
        expect(result.status).toBe('error');
        expect(result.error).toBeDefined();
    });

    test('should fallback to basic summary on LLM error', async () => {
        const mockSteps = [{
            tool: 'test',
            action: 'action',
            parameters: {}
        }];

        const enrichedMessage = {
            original_message: 'test message',
            plan: JSON.stringify(mockSteps)
        };

        openaiClient.createCompletion.mockRejectedValue(new Error('LLM failed'));

        const result = await coordinator(enrichedMessage);

        expect(result.status).toBe('success');
        expect(logger.markdown).toHaveBeenCalled();
        const summary = logger.markdown.mock.calls[0][0];
        expect(summary).toContain('# Task Execution Summary');
    });
});

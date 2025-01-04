const { coordinator } = require('../src/coordinator');
const toolManager = require('../src/tools');

// Mock tools
jest.mock('../src/tools', () => ({
    loadTools: jest.fn().mockResolvedValue([
        {
            name: 'fileSystem',
            description: 'Tool for file operations',
            execute: jest.fn().mockResolvedValue({
                status: 'success',
                files: [{
                    name: 'test.txt',
                    type: 'file',
                    size: 100,
                    isReadOnly: false
                }]
            }),
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

describe('Coordinator Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should coordinate execution of plan successfully', async () => {
        const enrichedMessage = {
            original_message: 'list files',
            plan: JSON.stringify([{
                tool: 'fileSystem',
                action: 'list',
                parameters: { path: '/test' },
                description: 'List files in test directory'
            }])
        };

        const result = await coordinator(enrichedMessage);
        expect(result.status).toBe('success');
        expect(result.response).toContain('Completed actions');
        expect(result.response).toContain('test.txt');
        expect(result.response).toContain('100 bytes');
    });

    it('should handle missing plan', async () => {
        const enrichedMessage = {
            original_message: 'list files'
        };

        const result = await coordinator(enrichedMessage);
        expect(result.status).toBe('error');
        expect(result.error).toBe('No plan provided');
    });

    it('should handle invalid tool in plan', async () => {
        const enrichedMessage = {
            original_message: 'test message',
            plan: JSON.stringify([{
                tool: 'invalidTool',
                action: 'someAction',
                parameters: {},
                description: 'Test action'
            }])
        };

        const result = await coordinator(enrichedMessage);
        expect(result.status).toBe('error');
        expect(result.error).toContain('Tool not found: invalidTool');
        expect(result.stack).toBeDefined();
        expect(result.details).toBeDefined();
        expect(result.details.lastStep).toBeDefined();
        expect(result.details.lastStep.tool).toBe('invalidTool');
    });

    it('should handle tool execution errors', async () => {
        // Mock tool to throw error
        toolManager.loadTools.mockResolvedValueOnce([{
            name: 'fileSystem',
            description: 'Tool for file operations',
            execute: jest.fn().mockRejectedValue(new Error('Execution failed')),
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
        }]);

        const enrichedMessage = {
            original_message: 'list files',
            plan: JSON.stringify([{
                tool: 'fileSystem',
                action: 'list',
                parameters: { path: '/test' },
                description: 'List files'
            }])
        };

        const result = await coordinator(enrichedMessage);
        expect(result.status).toBe('error');
        expect(result.error).toContain('Execution failed');
        expect(result.stack).toBeDefined();
        expect(result.details).toBeDefined();
        expect(result.details.lastStep).toBeDefined();
        expect(result.details.lastStep.tool).toBe('fileSystem');
    });

    it('should handle invalid plan JSON', async () => {
        const enrichedMessage = {
            original_message: 'list files',
            plan: 'invalid json'
        };

        const result = await coordinator(enrichedMessage);
        expect(result.status).toBe('error');
        expect(result.error).toContain('Unexpected token');
        expect(result.stack).toBeDefined();
        expect(result.details).toBeDefined();
    });
});

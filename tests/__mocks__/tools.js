const mockTools = {
    loadTools: jest.fn().mockImplementation(() => {
        console.log('Loading tools');
        const tools = [{
            name: 'test',
            execute: jest.fn().mockImplementation(async (action, parameters) => {
                console.log('Executing tool:', action, parameters);
                const result = {
                    status: 'success',
                    data: { result: 'test' }
                };
                console.log('Tool execution result:', result);
                return result;
            })
        }];
        console.log('Loaded tools:', tools);
        return Promise.resolve(tools);
    }),
    executeTool: jest.fn()
};

module.exports = mockTools;

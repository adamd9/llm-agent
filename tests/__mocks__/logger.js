const mockLogger = {
    debug: jest.fn().mockImplementation((...args) => {
        console.log('DEBUG:', ...args);
    }),
    response: jest.fn(),
    markdown: jest.fn().mockImplementation((text) => {
        console.log('MARKDOWN:', text);
    })
};

module.exports = mockLogger;

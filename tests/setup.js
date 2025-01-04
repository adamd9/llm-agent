// Mock environment variables
process.env.OPENAI_API_KEY = 'test-api-key';

// Silence console logs during tests
console.log = jest.fn();
console.error = jest.fn();

// Set timeout for tests
jest.setTimeout(10000);

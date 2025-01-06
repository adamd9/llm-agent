const { Ego } = require('../ego');
const sharedEventEmitter = require('../eventEmitter');

describe('Ego Class', () => {
    let ego;

    beforeEach(() => {
        ego = new Ego('test-identity');
    });

    test('handleBubble should process string input', async () => {
        const input = 'This is a test string.';
        const result = await ego.handleBubble(input);
        expect(result).toBeDefined(); // Add more specific expectations based on handleConversation implementation
    });

    test('handleBubble should process object input', async () => {
        const input = { key: 'value' };
        const result = await ego.handleBubble(input);
        expect(result).toBeDefined(); // Add more specific expectations based on handleConversation implementation
    });

    test('handleBubble should throw error for invalid input', async () => {
        await expect(ego.handleBubble(123)).rejects.toThrow('Input must be a string or an object');
    });
});

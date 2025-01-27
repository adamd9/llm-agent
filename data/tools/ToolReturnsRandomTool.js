/**
 * @implements {import('../types/tool').Tool}
 */
class RandomHexColorTool {
    constructor() {
        this.name = 'Random Hex Color Tool';
        this.description = 'A tool that returns a random hex color.';
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'a_tool_that_returns_a_random_hex_color',
                    description: 'A tool that returns a random hex color.',
                    parameters: []
                }
            ]
        };
    }

    async execute(action, parameters) {
        if (action !== 'a_tool_that_returns_a_random_hex_color' || parameters.length !== 0) {
            return { status: 'error', error: 'Error: Invalid action or parameters. Expected action: a_tool_that_returns_a_random_hex_color with no parameters.' };
        }

        const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16)}`;
        return { status: 'success', message: randomColor };
    }
}

module.exports = new RandomHexColorTool();
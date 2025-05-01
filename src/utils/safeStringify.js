/**
 * Safely stringify objects with circular references
 * @param {any} obj - Object to stringify
 * @returns {string} - JSON string with circular references replaced
 */
function safeStringify(obj) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular Reference]';
            }
            seen.add(value);
            
            // Handle special cases
            if (value.constructor) {
                if (value.constructor.name === 'OpenAI') {
                    return '[OpenAI Client Instance]';
                }
                if (value.constructor.name === 'Completions') {
                    return '[OpenAI Completions Instance]';
                }
                if (value.constructor.name === 'Responses') {
                    return '[OpenAI Responses Instance]';
                }
            }
        }
        return value;
    }, 2);
}

module.exports = safeStringify;

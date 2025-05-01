/**
 * Safely stringify objects with circular references
 * @param {any} obj - Object to stringify
 * @param {string} [context] - Optional context for where this stringification is happening
 * @returns {string} - JSON string with circular references replaced
 */
function safeStringify(obj, context = '') {
    const seen = new WeakSet();
    const paths = [];
    
    // Get the caller stack
    const stack = new Error().stack;
    const caller = stack
        .split('\n')
        .slice(2, 3)[0]
        .trim()
        .replace(/^at /, '')
        .split(' ')[0];
    
    return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
            // Track the path to this property
            if (key) {
                paths.push(key);
            }
            
            if (seen.has(value)) {
                const circularPath = paths.join('.');
                const circularInfo = {
                    message: '[Circular Reference]',
                    path: circularPath,
                    context: context || 'unknown',
                    objectType: value.constructor ? value.constructor.name : 'Object',
                    caller: caller,
                    parentKey: paths[paths.length - 2] || 'root', // Get the parent key
                    value: Object.keys(value) // Show what keys were in the circular object
                };
                
                // Remove the last path segment as we're moving back up
                paths.pop();
                return circularInfo;
            }
            seen.add(value);
            
            // Handle special cases
            if (value.constructor) {
                if (value.constructor.name === 'OpenAI') {
                    paths.pop();
                    return '[OpenAI Client Instance]';
                }
                if (value.constructor.name === 'Completions') {
                    paths.pop();
                    return '[OpenAI Completions Instance]';
                }
                if (value.constructor.name === 'Responses') {
                    paths.pop();
                    return '[OpenAI Responses Instance]';
                }
            }
        }
        
        // Remove the last path segment as we're moving back up
        if (typeof value === 'object' && value !== null) {
            paths.pop();
        }
        
        return value;
    }, 2);
}

module.exports = safeStringify;

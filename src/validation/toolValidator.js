const Ajv = require('ajv');
const { 
    toolCapabilitiesSchema,
    toolResponseSchema
} = require('./toolSchema');

const ajv = new Ajv();

/**
 * Validates a tool implementation against the required interface
 * @param {import('../types/tool').Tool} tool - Tool to validate
 * @returns {{isValid: boolean, errors: string[]}} Validation result
 */
function validateTool(tool) {
    const errors = [];

    // Check required properties
    const requiredProps = ['name', 'description', 'getCapabilities', 'execute'];
    for (const prop of requiredProps) {
        if (!(prop in tool)) {
            errors.push(`Missing required property: ${prop}`);
        }
    }

    // Check property types
    if (typeof tool.name !== 'string') {
        errors.push('Tool name must be a string');
    }
    if (typeof tool.description !== 'string') {
        errors.push('Tool description must be a string');
    }
    if (typeof tool.getCapabilities !== 'function') {
        errors.push('getCapabilities must be a function');
    }
    if (typeof tool.execute !== 'function') {
        errors.push('execute must be a function');
    }

    // Validate capabilities structure if getCapabilities exists
    if (typeof tool.getCapabilities === 'function') {
        try {
            const capabilities = tool.getCapabilities();
            const validateCapabilities = ajv.compile(toolCapabilitiesSchema);
            if (!validateCapabilities(capabilities)) {
                errors.push('Invalid capabilities structure:', ...validateCapabilities.errors.map(e => 
                    `${e.instancePath} ${e.message}`
                ));
            }
        } catch (error) {
            errors.push(`Error calling getCapabilities: ${error.message}`);
        }
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validates a tool's response
 * @param {import('../types/tool').ToolResponse} response - Response to validate
 * @returns {{isValid: boolean, errors: string[]}} Validation result
 */
function validateToolResponse(response) {
    const validateResponse = ajv.compile(toolResponseSchema);
    if (!validateResponse(response)) {
        return {
            isValid: false,
            errors: validateResponse.errors.map(e => `${e.instancePath} ${e.message}`)
        };
    }
    return {
        isValid: true,
        errors: []
    };
}

module.exports = {
    validateTool,
    validateToolResponse
};

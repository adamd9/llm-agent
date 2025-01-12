const { isValidTool } = require('./index');
const fs = require('fs');
const path = require('path');
const { getClient } = require('../utils/llmClient');
const ToolManager = require('./index.js');

class ToolGenerator {
    constructor() {
        this.name = 'toolGenerator';
        this.description = 'A tool for generating new tools based on natural language descriptions';
        this.toolManager = require('./index.js');  
        this.dataToolsDir = path.join(__dirname, '../../data/tools');
    }

    /**
     * Get the capabilities of the tool generator
     * @returns {Object} Capabilities object with actions
     */
    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'generateTool',
                    description: 'Generate a new tool based on a description',
                    parameters: [
                        {
                            name: 'description',
                            description: 'Description of the tool to generate',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'contextPrompt',
                            description: 'Additional context for tool generation',
                            type: 'string',
                            required: false
                        },
                        {
                            name: 'save',
                            description: 'Whether to save the tool to disk',
                            type: 'boolean',
                            required: false
                        }
                    ]
                },
                {
                    name: 'updateTool',
                    description: 'Update an existing tool',
                    parameters: [
                        {
                            name: 'toolName',
                            description: 'Name of the tool to update',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'updates',
                            description: 'Updates to apply to the tool',
                            type: 'object',
                            required: true
                        },
                        {
                            name: 'contextPrompt',
                            description: 'Additional context for tool update',
                            type: 'string',
                            required: false
                        }
                    ]
                }
            ]
        };
    }

    /**
     * Generate examples based on tool description and constraints
     * @param {string} description Tool description
     * @param {string} contextPrompt Additional context for example generation
     * @param {Object} constraints Constraints for example generation
     * @returns {Array} Generated examples
     */
    generateExamples(description, contextPrompt, constraints) {
        // Start with empty examples array
        const examples = [];

        // Parse constraints
        const {
            inputTypes = [],
            outputTypes = [],
            complexity = 'moderate',
            coverage = []
        } = constraints || {};

        // Generate basic happy path example
        if (inputTypes.length > 0) {
            const basicExample = this._generateBasicExample(inputTypes, outputTypes);
            examples.push(basicExample);
        }

        // Generate error cases
        const errorExample = this._generateErrorExample(inputTypes);
        examples.push(errorExample);

        // Generate edge cases based on complexity
        if (complexity === 'complex') {
            const edgeCases = this._generateEdgeCases(inputTypes, outputTypes);
            examples.push(...edgeCases);
        }

        return examples;
    }

    /**
     * Generate a basic example for the happy path
     * @private
     */
    _generateBasicExample(inputTypes, outputTypes) {
        const input = this._generateInputForTypes(inputTypes);
        const output = this._generateOutputForTypes(outputTypes, true);

        return {
            input,
            expectedOutput: output,
            description: 'Basic successful operation',
            coverage: ['happy_path']
        };
    }

    /**
     * Generate an error example
     * @private
     */
    _generateErrorExample(inputTypes) {
        const input = this._generateInputForTypes(inputTypes, true);
        return {
            input,
            expectedOutput: { success: false, error: 'Error description based on invalid input' },
            description: 'Error handling for invalid input',
            coverage: ['error_handling']
        };
    }

    /**
     * Generate edge cases
     * @private
     */
    _generateEdgeCases(inputTypes, outputTypes) {
        return [
            {
                input: this._generateInputForTypes(inputTypes, false, true),
                expectedOutput: this._generateOutputForTypes(outputTypes, true),
                description: 'Edge case with maximum valid values',
                coverage: ['edge_case', 'maximum_values']
            },
            {
                input: this._generateInputForTypes(inputTypes, false, false, true),
                expectedOutput: this._generateOutputForTypes(outputTypes, true),
                description: 'Edge case with minimum valid values',
                coverage: ['edge_case', 'minimum_values']
            }
        ];
    }

    /**
     * Generate input values based on types
     * @private
     */
    _generateInputForTypes(types, isError = false, isMax = false, isMin = false) {
        const input = {};
        types.forEach(type => {
            switch (type) {
                case 'string':
                    input[`${type}Param`] = isError ? '' : 'example-string';
                    break;
                case 'number':
                    input[`${type}Param`] = isError ? NaN : (isMax ? Number.MAX_SAFE_INTEGER : (isMin ? 0 : 42));
                    break;
                case 'boolean':
                    input[`${type}Param`] = !isError;
                    break;
                case 'file':
                    input.path = isError ? 'nonexistent.file' : 'example.file';
                    break;
                case 'array':
                    input[`${type}Param`] = isError ? null : (isMax ? Array(1000).fill('item') : (isMin ? [] : ['item1', 'item2']));
                    break;
                case 'object':
                    input[`${type}Param`] = isError ? null : { key: 'value' };
                    break;
            }
        });
        return input;
    }

    /**
     * Generate output values based on types
     * @private
     */
    _generateOutputForTypes(types, success = true) {
        if (!success) {
            return { success: false, error: 'Operation failed' };
        }

        const output = { success: true };
        types.forEach(type => {
            switch (type) {
                case 'string':
                    output[`${type}Result`] = 'result-string';
                    break;
                case 'number':
                    output[`${type}Result`] = 42;
                    break;
                case 'boolean':
                    output[`${type}Result`] = true;
                    break;
                case 'file':
                    output.path = 'result.file';
                    break;
                case 'array':
                    output[`${type}Result`] = ['result1', 'result2'];
                    break;
                case 'object':
                    output[`${type}Result`] = { key: 'result' };
                    break;
            }
        });
        return output;
    }

    /**
     * Generate tool code based on description and examples
     * @private
     */
    async _generateToolCode(toolName, description, examples, capabilities) {
        try {
            // Generate the action methods
            const actionMethods = capabilities.actions.map(action => {
                const paramValidation = action.parameters.map(param => 
                    `const ${param.name}Param = parameters.find(param => param.name === '${param.name}');
                    ${param.required ? 
                        `if (!${param.name}Param) {
                            throw new Error('Missing required parameter: ${param.name}');
                        }` : ''}`
                ).join('\n        ');

                const paramExtraction = action.parameters.map(param => 
                    `const ${param.name} = ${param.name}Param${param.required ? '' : '?'}.value;`
                ).join('\n            ');

                return `
    async ${action.name}(parameters) {
        ${paramValidation}

        try {
            ${paramExtraction}
            
            // TODO: Implement ${action.name} logic here
            return {
                status: 'success',
                result: {
                    // Add your result fields here
                }
            };
        } catch (error) {
            logger.debug('tools', '${toolName} error:', error);
            return {
                status: 'error',
                error: 'Failed to execute ${action.name}',
                details: error.message
            };
        }
    }`;
            }).join('\n\n');

            // Create switch cases for execute method
            const switchCases = capabilities.actions.map(action => 
                `                case '${action.name}':
                    return await this.${action.name}(parsedParams);`
            ).join('\n');

            // Create the template
            const template = `
const logger = require('../../src/utils/logger');

class ${toolName} {
    constructor() {
        this.name = '${toolName.charAt(0).toLowerCase() + toolName.slice(1)}';
        this.description = '${description}';
    }

    getCapabilities() {
        return ${JSON.stringify(capabilities, null, 8)};
    }

    ${actionMethods}

    async execute(action, parameters) {
        logger.debug('tools', '${toolName} executing:', { action, parameters });
        try {
            // Parse parameters if they're passed as a string
            let parsedParams = parameters;
            if (typeof parameters === 'string') {
                try {
                    parsedParams = JSON.parse(parameters);
                } catch (parseError) {
                    logger.debug('tools', 'Parameter parsing error:', {
                        error: parseError.message,
                        parameters
                    });
                    return {
                        status: 'error',
                        error: 'Invalid parameters format',
                        details: parseError.message
                    };
                }
            }

            // Validate that parsedParams is an array
            if (!Array.isArray(parsedParams)) {
                return {
                    status: 'error',
                    error: 'Parameters must be provided as an array'
                };
            }

            switch (action) {
${switchCases}
                default:
                    throw new Error(\`Unknown action: \${action}\`);
            }
        } catch (error) {
            logger.debug('tools', '${toolName} error:', {
                error: error.message,
                stack: error.stack,
                action,
                parameters
            });
            return {
                status: 'error',
                error: error.message,
                stack: error.stack,
                action,
                parameters
            };
        }
    }
}

module.exports = new ${toolName}();
`;

            return template;
        } catch (error) {
            throw new Error(`Failed to generate tool implementation: ${error.message}`);
        }
    }

    /**
     * Generate updated tool code based on description and examples
     * @private
     */
    async _generateUpdatedToolCode(toolName, description, examples, capabilities, existingCode, contextPrompt) {
        // Generate implementation using LLM
        const prompt = `You are a JavaScript developer tasked with updating an existing tool implementation.

Current Implementation:
${existingCode}

Required Updates:
1. Tool Name: ${toolName} (must remain exactly the same)
2. New Description: ${description}
3. New Capabilities: ${JSON.stringify(capabilities, null, 2)}
4. Update Context: ${contextPrompt}

The updated implementation must:
1. Keep the exact same class name and module.exports
2. Update the description and capabilities as specified
3. Update the execute method to handle the new parameters
4. Maintain any existing functionality not affected by the updates
5. Keep any useful helper methods or properties from the original code
6. Return results in {success: true/false, data?: any, error?: string} format

Example test cases:
${JSON.stringify(examples, null, 2)}

Generate only the complete updated JavaScript class implementation with no explanation or comments.`;

        try {
            // Get LLM client
            const llmClient = getClient('openai');
            
            // Generate implementation
            const response = await llmClient.chat([
                { 
                    role: 'system', 
                    content: 'You are an expert JavaScript developer who writes clean, efficient, and well-documented code. You are particularly skilled at updating existing code while maintaining its core functionality.' 
                },
                { role: 'user', content: prompt }
            ], {
                model: 'gpt-4o',
                temperature: 0.2,
                max_tokens: 2000
            });

            // Extract code from response
            let code = response.content;
            
            // Clean up the code if it's wrapped in markdown code blocks
            code = code.replace(/```javascript\n?|\n?```/g, '').trim();

            console.log('Generated updated code:', code);

            // Validate the generated code
            const validationResult = await this._validateGeneratedCode(code, toolName, description, capabilities);
            if (!validationResult.valid) {
                console.error('Code validation failed:', validationResult.reasons);
                throw new Error(`Generated code does not meet requirements: ${validationResult.reasons.join(', ')}`);
            }

            return code;
        } catch (error) {
            throw new Error(`Failed to generate updated tool implementation: ${error.message}`);
        }
    }

    /**
     * Save tool to data/tools folder
     * @private
     */
    async _saveToolToFile(toolName, code) {
        // Create tools directory if it doesn't exist
        if (!fs.existsSync(this.dataToolsDir)) {
            fs.mkdirSync(this.dataToolsDir, { recursive: true });
        }

        // Always use .js extension since we're generating JavaScript tools
        const fileName = `${toolName.toLowerCase()}.js`;
        const filePath = path.join(this.dataToolsDir, fileName);
        
        // Ensure code is a string
        const codeStr = typeof code === 'string' ? code : await code;
        
        await fs.promises.writeFile(filePath, codeStr, 'utf8');
        return filePath;
    }

    /**
     * Load tool from data/tools folder
     * @private
     */
    async _loadTool(toolName) {
        try {
            const toolInfo = await this._findToolByName(toolName);
            const code = await fs.promises.readFile(toolInfo.filePath, 'utf8');
            return { code, filePath: toolInfo.filePath };
        } catch (error) {
            throw new Error(`Failed to load tool: ${error.message}`);
        }
    }

    async _findToolByName(toolNameOrDescription) {
        // Get LLM client for semantic matching
        const llmClient = getClient('openai');
        
        // Load all tools
        await this.toolManager.loadTools();
        const tools = Array.from(this.toolManager.tools.values());
        
        // If exact match exists, return it
        const exactMatch = tools.find(t => t.name === toolNameOrDescription);
        if (exactMatch) {
            return {
                tool: exactMatch,
                filePath: path.join(this.dataToolsDir, `${exactMatch.name}.js`)
            };
        }

        // Generate embeddings or use LLM to find best match
        const prompt = `Given the tool name or description "${toolNameOrDescription}", which of these tools is the most likely match? Consider file names, tool names, and descriptions. Only return the exact name of the best matching tool, nothing else.

Available tools:
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}`;

        const response = await llmClient.chat([
            { role: 'system', content: 'You are a tool matching expert. Only respond with the exact tool name that best matches the query.' },
            { role: 'user', content: prompt }
        ], {
            model: 'gpt-4o',
            temperature: 0.2
        });

        const matchedName = response.content.trim();
        const matchedTool = tools.find(t => t.name === matchedName);
        
        if (!matchedTool) {
            throw new Error(`Could not find a matching tool for "${toolNameOrDescription}"`);
        }

        return {
            tool: matchedTool,
            filePath: path.join(this.dataToolsDir, `${matchedTool.name}.js`)
        };
    }

    /**
     * Test a tool with examples
     * @private
     */
    async _testTool(toolName, examples) {
        try {
            const { filePath } = await this._loadTool(toolName);
            const tool = require(filePath);

            if (!isValidTool(tool)) {
                throw new Error(`Invalid tool: ${toolName}`);
            }

            const results = [];
            for (const example of examples) {
                try {
                    const result = await tool.execute(example.input);
                    const passed = JSON.stringify(result) === JSON.stringify(example.expectedOutput);
                    results.push({
                        description: example.description,
                        passed,
                        expected: example.expectedOutput,
                        actual: result
                    });
                } catch (error) {
                    results.push({
                        description: example.description,
                        passed: false,
                        error: error.message
                    });
                }
            }

            return results;
        } catch (error) {
            throw new Error(`Failed to test tool: ${error.message}`);
        }
    }

    async _updateTool(toolName, updates, contextPrompt) {
        console.log('_updateTool called with:', { toolName, updates, contextPrompt });
        
        try {
            // Load existing tool
            const { code: existingCode, filePath } = await this._loadTool(toolName);
            
            // Parse existing code to extract current capabilities
            const currentTool = require(filePath);
            const currentCapabilities = currentTool.getCapabilities();
            
            console.log('Current capabilities:', currentCapabilities);
            
            // Create updated capabilities
            const updatedCapabilities = {
                actions: currentCapabilities.map(action => {
                    // Update action parameters if provided
                    if (updates.parameters) {
                        return {
                            ...action,
                            parameters: updates.parameters
                        };
                    }
                    return action;
                })
            };
            
            console.log('Updated capabilities:', updatedCapabilities);

            // Generate examples for the updated tool
            const examples = this.generateExamples(
                updates.description || currentTool.description,
                contextPrompt,
                { inputTypes: updatedCapabilities.actions[0].parameters.map(p => p.type) }
            );

            // Generate updated code using the existing code as reference
            const updatedCode = await this._generateUpdatedToolCode(
                toolName,
                updates.description || currentTool.description,
                examples,
                updatedCapabilities,
                existingCode,
                contextPrompt
            );

            // Save updated tool
            await this._saveToolToFile(toolName, updatedCode);

            // Create a user-friendly message about the changes
            const parameterChanges = updates.parameters ? 
                `Updated parameters: ${updates.parameters.map(p => `${p.name} (${p.type}${p.required ? ', required' : ''})`).join(', ')}` :
                'No parameter changes';

            return {
                success: true,
                toolName,
                filePath,
                capabilities: updatedCapabilities,
                newExamples: examples,
                message: `Successfully updated tool '${toolName}'. ${parameterChanges}`
            };
        } catch (error) {
            console.error('Update tool error:', error);
            throw error;
        }
    }

    /**
     * Generate tool name from description
     * @private
     */
    _generateToolName(description) {
        if (!description || typeof description !== 'string') {
            throw new Error('Tool description is required and must be a string');
        }

        // Extract key words from the description
        const words = description.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => 
                !['a', 'an', 'the', 'to', 'from', 'that', 'which', 'with', 'for', 'and', 'or', 'will', 'based'].includes(word) && 
                word.length > 0
            )
            .map(word => word.charAt(0).toUpperCase() + word.slice(1));
        
        if (words.length === 0) {
            // If no valid words found, use a generic name with a timestamp
            const timestamp = Date.now();
            return `CustomTool${timestamp}`;
        }

        // Take the first 3 most relevant words to form the tool name
        const toolName = words.slice(0, 3).join('') + 'Tool';
        
        // Ensure the first character is uppercase
        return toolName.charAt(0).toUpperCase() + toolName.slice(1);
    }

    /**
     * Generate capabilities from description and constraints
     * @private
     */
    _generateCapabilities(description, constraints) {
        // If constraints.inputTypes is provided, use it to generate parameters
        const parameters = constraints?.inputTypes?.map(input => ({
            name: input.name,
            description: input.description,
            type: input.type || this._inferParameterType(input.name),
            required: input.required !== false // Default to true unless explicitly set to false
        })) || [];

        // Generate action name based on description
        const actionName = description.toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');

        return {
            actions: [
                {
                    name: actionName,
                    description: description,
                    parameters: parameters
                }
            ]
        };
    }

    _inferParameterType(param) {
        const paramLower = param.toLowerCase();
        if (/number|count|amount|quantity|index|id/i.test(paramLower)) return 'number';
        if (/boolean|flag|condition|state/i.test(paramLower)) return 'boolean';
        if (/array|list|collection|set/i.test(paramLower)) return 'array';
        if (/object|config|options|settings/i.test(paramLower)) return 'object';
        if (/file|path/i.test(paramLower)) return 'string';
        return 'string';
    }

    /**
     * Execute the tool generator
     * @param {string|Object} actionOrParams Action name or parameters object
     * @param {Array|Object} [parameters] Parameters for the action
     * @returns {Object} Generated tool code and examples
     */
    async execute(actionOrParams, parameters) {
        try {
            let params;
            if (typeof actionOrParams === 'string' && parameters) {
                if (Array.isArray(parameters)) {
                    params = parameters.reduce((acc, param) => {
                        if (param && typeof param === 'object' && 'name' in param && 'value' in param) {
                            acc[param.name] = param.value;
                        }
                        return acc;
                    }, {});
                } else if (typeof parameters === 'object') {
                    params = parameters;
                }
            } else if (typeof actionOrParams === 'object') {
                params = actionOrParams;
            } else {
                throw new Error('Parameters must be provided as an object or action string with parameters');
            }

            // Ensure we have a description
            const description = params.description || (params.parameters && params.parameters.find(p => p.name === 'description')?.value);
            if (!description) {
                throw new Error('Description is required for generating a tool');
            }

            const action = params.action || 'generateTool';

            switch (action) {
                case 'generateTool': {
                    const {
                        contextPrompt,
                        constraints = {
                            inputTypes: [],
                            outputTypes: [],
                            complexity: 'moderate',
                            coverage: ['happy', 'error']
                        },
                        context,
                        capabilities,
                        save = false
                    } = params;

                    // Generate examples with default constraints
                    const examples = this.generateExamples(description, contextPrompt, constraints);

                    // Generate tool name from description
                    const toolName = this._generateToolName(description);
                    if (!toolName || typeof toolName !== 'string' || toolName.length === 0) {
                        throw new Error('Failed to generate valid tool name');
                    }

                    // Generate capabilities if not explicitly provided
                    const finalCapabilities = capabilities || this._generateCapabilities(description, constraints);

                    // Generate tool code
                    const code = await this._generateToolCode(toolName, description, examples, finalCapabilities);

                    // Save tool if requested
                    let filePath;
                    if (save) {
                        filePath = await this._saveToolToFile(toolName, code);
                    }

                    return {
                        success: true,
                        toolName,
                        code,
                        examples,
                        capabilities: finalCapabilities,
                        context,
                        filePath
                    };
                }

                case 'updateTool': {
                    console.log('Processing updateTool with params:', params);
                    
                    // Extract and validate toolName
                    const { toolName } = params;
                    if (!toolName) {
                        throw new Error('Tool name is required for updating a tool');
                    }

                    // Extract updates with fallback to empty object
                    let updates = {};
                    if ('updates' in params) {
                        if (typeof params.updates === 'string') {
                            try {
                                // Clean up the JSON string if needed
                                const cleanJson = params.updates.replace(/}"+$/, '}');
                                updates = JSON.parse(cleanJson);
                            } catch (e) {
                                console.error('Failed to parse updates JSON:', params.updates, e);
                                throw new Error('Updates string must be valid JSON');
                            }
                        } else if (params.updates && typeof params.updates === 'object') {
                            updates = params.updates;
                        }
                    }
                    
                    console.log('Processed updates:', updates);

                    // Validate updates object
                    if (typeof updates !== 'object' || Array.isArray(updates)) {
                        throw new Error('Updates must be a valid object');
                    }

                    const result = await this._updateTool(toolName, updates, params.contextPrompt);
                    result.message = `Tool '${toolName}' updated successfully.`;
                    return result;
                }

                case 'testTool': {
                    if (!params.toolName) {
                        throw new Error('Tool name is required for testing a tool');
                    }

                    const { toolName, examples } = params;
                    const results = await this._testTool(toolName, examples || []);
                    return {
                        success: true,
                        toolName,
                        testResults: results,
                        message: `Tool '${toolName}' tested successfully.`
                    };
                }

                case 'validateTool': {
                    const { toolName } = params;
                    if (!toolName) {
                        throw new Error('Tool name is required for validation');
                    }

                    try {
                        // Find and load the tool
                        const { code: existingCode, filePath } = await this._loadTool(toolName);
                        
                        // Get tool module for validation
                        const toolModule = require(filePath);
                        
                        // Get current description and capabilities
                        const description = toolModule.description;
                        const capabilities = toolModule.getCapabilities();

                        // Basic tool validation using ToolManager's isValidTool
                        const isValid = this.toolManager.isValidTool(toolModule);
                        const basicValidationIssues = isValid ? [] : ['Tool fails basic validation checks'];

                        // Detailed code validation
                        const codeValidation = await this._validateGeneratedCode(
                            existingCode,
                            toolModule.name,
                            description,
                            capabilities
                        );

                        // Combine validation results
                        const allIssues = [...basicValidationIssues, ...codeValidation.reasons];

                        return {
                            success: isValid && codeValidation.valid,
                            toolName: toolModule.name,
                            valid: isValid && codeValidation.valid,
                            issues: allIssues,
                            message: isValid && codeValidation.valid ? 
                                `Tool '${toolModule.name}' passed all validation checks.` :
                                `Tool '${toolModule.name}' has validation issues: ${allIssues.join(', ')}`
                        };
                    } catch (error) {
                        if (error.message.includes('Could not find a matching tool')) {
                            return {
                                success: false,
                                error: `No matching tool found for "${toolName}"`,
                                message: `Could not find a tool matching "${toolName}". Please check the tool name or provide a more specific description.`
                            };
                        }
                        throw error;
                    }
                }

                default: {
                    // Try to find the tool and execute it
                    const toolInfo = await this._findToolByName(params.toolName || this.name);
                    if (!toolInfo || !toolInfo.tool) {
                        throw new Error('Tool not found');
                    }

                    // Convert array parameters to object if needed
                    let execParams = {};
                    if (Array.isArray(params.parameters)) {
                        params.parameters.forEach(param => {
                            if (param.name && 'value' in param) {
                                execParams[param.name] = param.value;
                            }
                        });
                    } else {
                        execParams = params.parameters || {};
                    }

                    // Execute the tool with converted parameters
                    return await toolInfo.tool.execute(execParams);
                }
            }
        } catch (error) {
            console.error('Tool execution error:', error);
            return {
                success: false,
                error: error.message,
                details: error.stack,
                message: 'An error occurred while executing the tool.'
            };
        }
    }
}

module.exports = new ToolGenerator();

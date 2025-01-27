const { isValidTool } = require('./index');
const fs = require('fs');
const path = require('path');
const { getOpenAIClient } = require('../utils/openaiClient.js');
const ToolManager = require('./index.js');
const { validateTool, validateToolResponse } = require('../validation/toolValidator');
const logger = require('../utils/logger.js');

/** @implements {import('../types/tool').Tool} */
class ToolGenerator {
    constructor() {
        this.name = 'toolGenerator';
        this.description = 'A tool for generating new tools based on natural language descriptions';
        this.toolManager = require('./index.js');  
        this.dataToolsDir = path.join(__dirname, '../../data/tools');
    }

    /** @returns {import('../types/tool').ToolCapabilities} */
    getCapabilities(toolName) {
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
                            description: 'Whether to save the generated tool to disk',
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
                        }
                    ]
                }
            ]
        };
    }

    async _generateToolCode(description, examples, capabilities, maxRetries = 3) {
        const prompt = `Create a JavaScript tool class that:
1. Matches this description: ${description}
2. Supports these capabilities: ${JSON.stringify(capabilities, null, 2)}
3. Handles these example cases: ${JSON.stringify(examples, null, 2)}

Important guidelines:
1. ONLY use these approved dependencies:
   - Native Node.js modules (fs, path, etc)
   - Native fetch API for HTTP requests (no axios, request, etc)
   - Already imported modules from relative paths
2. For HTTP requests, use fetch like this:
   await fetch(url, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(data)
   });
3. Parameters are passed as an array of objects with name/value pairs:
   parameters = [
     { name: 'paramName', value: paramValue }
   ]
   Always use parameters.find(p => p.name === 'name').value to get values

Required structure (copy this EXACTLY):
/**
 * @implements {import('../types/tool').Tool}
 */
class YourToolName {
    constructor() {
        this.name = 'toolName';  // Lowercase, no spaces
        this.description = 'Tool description';  // Must be a string
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'actionName',  // Must match execute method
                    description: 'Action description',
                    parameters: []  // Add parameters as needed
                }
            ]
        };
    }

    async execute(action, parameters) {
        try {
            switch (action) {
                case 'actionName': {
                    // Get parameters by name from the parameters array
                    const param1 = parameters.find(p => p.name === 'parameterName');
                    if (!param1 || !param1.value) {
                        return { status: 'error', error: 'Invalid input: parameterName is required' };
                    }

                    // Implementation using param1.value
                    return { status: 'success', message: 'Success message' };
                }
                default:
                    return { status: 'error', error: \`Unknown action: \${action}\` };
            }
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }
}

module.exports = new YourToolName();

Requirements:
1. Use CommonJS (require/module.exports), NOT ES modules (import/export)
2. Return {status: 'success', message: string} for success
3. Return {status: 'error', error: string} for errors
4. Include proper error handling
5. Use TypeScript-style JSDoc annotations
6. Make the tool practical and useful
7. Include all necessary imports at the top`;

        let attempts = 0;
        let lastError = null;
        const strategies = [
            { 
                model: 'gpt-4o', 
                temp: 0.2,
                systemPrompt: 'You are a JavaScript developer expert in creating tools. Follow the template EXACTLY. Only return valid CommonJS JavaScript code with no markdown.'
            },
            { 
                model: 'gpt-4o', 
                temp: 0.1,
                systemPrompt: 'You are a JavaScript developer expert in creating tools. Focus on matching the interface exactly. Only return valid CommonJS JavaScript code.'
            },
            { 
                model: 'gpt-4o', 
                temp: 0.1,
                systemPrompt: 'You are a minimal JavaScript developer. Create the simplest possible implementation that matches the interface. Only use native fetch for HTTP requests.'
            }
        ];

        while (attempts < maxRetries) {
            try {
                attempts++;
                const strategy = strategies[attempts - 1] || strategies[0];
                logger.debug('toolGenerator', `Attempt ${attempts} to generate tool code using strategy:`, strategy);

                const openai = getOpenAIClient();
                const messages = [
                    { 
                        role: 'system', 
                        content: strategy.systemPrompt
                    },
                    { role: 'user', content: prompt }
                ];

                if (lastError) {
                    messages.push({
                        role: 'user',
                        content: `Previous attempt failed validation with error: ${lastError}. Please fix these issues and try again. Remember to only use native fetch for HTTP requests, no external libraries.`
                    });
                }

                const response = await openai.chat(messages, {
                    model: strategy.model,
                    temperature: strategy.temp,
                    max_tokens: 1000
                });

                // Clean up the response
                let code = response.content;
                code = code.replace(/```javascript\n?|\n?```/g, '');
                code = code.replace(/^[\s\S]*?(?=(?:const|class|let|var|\/\*\*))/, '');
                code = code.replace(/\/\/ Example Usage[\s\S]*$/, '');
                code = code.trim();

                // Create a temporary file for validation
                const tempFile = path.join(this.dataToolsDir, '_temp_validation.js');
                
                try {
                    // Ensure directory exists
                    if (!fs.existsSync(this.dataToolsDir)) {
                        fs.mkdirSync(this.dataToolsDir, { recursive: true });
                    }

                    fs.writeFileSync(tempFile, code, 'utf8');
                    const tempModule = require(tempFile);
                    const validation = validateTool(tempModule);
                    
                    fs.unlinkSync(tempFile);
                    delete require.cache[require.resolve(tempFile)];

                    if (validation.isValid) {
                        logger.debug('toolGenerator', 'Tool validation successful');
                        return code;
                    } else {
                        lastError = validation.errors.join(', ');
                        logger.debug('toolGenerator', `Tool validation failed: ${lastError}`);
                        if (attempts >= maxRetries) {
                            throw new Error(`Tool validation failed after ${maxRetries} attempts: ${lastError}`);
                        }
                    }
                } catch (error) {
                    lastError = error.message;
                    logger.debug('toolGenerator', `Tool validation error: ${lastError}`);
                    if (attempts >= maxRetries) {
                        throw error;
                    }
                } finally {
                    if (fs.existsSync(tempFile)) {
                        fs.unlinkSync(tempFile);
                    }
                }
            } catch (error) {
                lastError = error.message;
                logger.debug('toolGenerator', `Generation attempt ${attempts} failed: ${lastError}`);
                if (attempts >= maxRetries) {
                    throw new Error(`Failed to generate valid tool after ${maxRetries} attempts: ${lastError}`);
                }
            }
        }

        throw new Error(`Failed to generate valid tool after ${maxRetries} attempts: ${lastError}`);
    }

    /**
     * @param {string} action - Action to execute
     * @param {any[]} parameters - Action parameters
     * @returns {Promise<import('../types/tool').ToolResponse>}
     */
    async execute(action, parameters) {
        try {
            switch (action) {
                case 'generateTool': {
                    const description = parameters.find(p => p.name === 'description')?.value;
                    const contextPrompt = parameters.find(p => p.name === 'contextPrompt')?.value;
                    const save = parameters.find(p => p.name === 'save')?.value || false;

                    if (!description) {
                        return { status: 'error', error: 'Missing required parameter: description' };
                    }

                    try {
                        // Generate examples and capabilities
                        const examples = await this.generateExamples(description, contextPrompt);
                        const capabilities = await this._generateCapabilities(description);

                        // Generate the tool code
                        const code = await this._generateToolCode(description, examples, capabilities);

                        if (save) {
                            // Extract class name from code
                            const classMatch = code.match(/class\s+(\w+)/);
                            if (!classMatch) {
                                throw new Error('Could not find class name in generated code');
                            }
                            const toolName = classMatch[1];
                            
                            const finalPath = await this._saveToolToFile(toolName, code);
                            
                            return {
                                status: 'success',
                                message: `Tool generated and saved to ${finalPath}`,
                                data: { code, path: finalPath }
                            };
                        } else {
                            return {
                                status: 'success',
                                message: 'Tool generated successfully',
                                data: { code }
                            };
                        }
                    } catch (error) {
                        logger.error('Error in tool generation:', error);
                        return {
                            status: 'error',
                            error: `Failed to generate tool: ${error.message}`
                        };
                    }
                }
                case 'updateTool': {
                    console.log('Processing updateTool with params:', parameters);
                    
                    // Extract and validate toolName
                    const { toolName } = parameters;
                    if (!toolName) {
                        throw new Error('Tool name is required for updating a tool');
                    }

                    // Extract updates with fallback to empty object
                    let updates = {};
                    if ('updates' in parameters) {
                        if (typeof parameters.updates === 'string') {
                            try {
                                // Clean up the JSON string if needed
                                const cleanJson = parameters.updates.replace(/}"+$/, '}');
                                updates = JSON.parse(cleanJson);
                            } catch (e) {
                                console.error('Failed to parse updates JSON:', parameters.updates, e);
                                throw new Error('Updates string must be valid JSON');
                            }
                        } else if (parameters.updates && typeof parameters.updates === 'object') {
                            updates = parameters.updates;
                        }
                    }
                    
                    console.log('Processed updates:', updates);

                    // Validate updates object
                    if (typeof updates !== 'object' || Array.isArray(updates)) {
                        throw new Error('Updates must be a valid object');
                    }

                    const result = await this._updateTool(toolName, updates, parameters.contextPrompt);
                    result.message = `Tool '${toolName}' updated successfully.`;
                    return result;
                }
                default:
                    return { status: 'error', error: `Unknown action: ${action}` };
            }
        } catch (error) {
            logger.error('ToolGenerator error:', error);
            return { status: 'error', error: error.message };
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
                actions: currentCapabilities.actions.map(action => {
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
                existingCode,
                updates.description || currentTool.description,
                examples,
                updatedCapabilities
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

    async _generateUpdatedToolCode(toolName, toolCode, description, examples, capabilities) {
        try {
            // Get LLM client
            const openai = getOpenAIClient();
            
            // Generate implementation
            const prompt = 
`You are updating a JavaScript tool. Here is the current implementation:

${toolCode}

Please update this tool to:
1. Match this description: ${description}
2. Support these capabilities: ${JSON.stringify(capabilities, null, 2)}
3. Handle these example cases: ${JSON.stringify(examples, null, 2)}

Important:
- Maintain the same class name and basic structure
- Keep existing imports
- Keep working functionality that doesn't need to change
- Only update what's necessary to support the new requirements
- Return {status: 'success', message: string} for success
- Return {status: 'error', error: string} for errors
- Include JSDoc comments for all changes`;

            const response = await openai.chat([
                { 
                    role: 'system', 
                    content: 'You are an expert JavaScript developer who writes clean, efficient, and well-documented code. You are particularly skilled at updating existing code while maintaining its core functionality.' 
                },
                { role: 'user', content: prompt }
            ], {
                model: 'gpt-4o',
                temperature: 0.7,
                max_tokens: 1000
            });

            return response.content;

        } catch (error) {
            logger.error('Failed to generate updated tool code:', error);
            throw new Error(`Failed to generate updated tool code: ${error.message}`);
        }
    }

    async _saveToolToFile(toolName, code) {
        // Create tools directory if it doesn't exist
        if (!fs.existsSync(this.dataToolsDir)) {
            fs.mkdirSync(this.dataToolsDir, { recursive: true });
        }

        // Use the provided tool name for the filename
        const fileName = toolName + '.js';
        const filePath = path.join(this.dataToolsDir, fileName);
        
        // Ensure code is a string
        const codeStr = typeof code === 'string' ? code : await code;
        
        await fs.promises.writeFile(filePath, codeStr, 'utf8');
        return filePath;
    }

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
        const openai = getOpenAIClient();
        
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

        const response = await openai.chat([
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

    async _validateGeneratedCode(code, toolName, description, capabilities) {
        try {
            // Create a temporary file to test the tool
            const tempFile = path.join(this.dataToolsDir, '_temp_tool.js');
            fs.writeFileSync(tempFile, code);

            // Load and validate the tool
            const tempTool = require(tempFile);
            const validation = validateTool(tempTool);

            // Remove the temporary file
            fs.unlinkSync(tempFile);

            return validation;
        } catch (error) {
            return { valid: false, reasons: [error.message] };
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
    async _generateCapabilities(description, constraints) {
        // If constraints.inputTypes is provided, use it to generate parameters
        const parameters = constraints?.inputTypes?.map(input => ({
            name: input.name,
            description: input.description,
            type: input.type || this._inferParameterType(input.name),
            required: input.required !== false // Default to true unless explicitly set to false
        })) || [];

        // Generate action name by extracting key verbs and nouns
        const openai = getOpenAIClient();
        const prompt = `Given this tool description: "${description}"
Generate a short, clear action name following these rules:
1. Use 1-2 words maximum
2. Start with a verb in camelCase (e.g. get, create, update, delete)
3. Add a noun only if needed for clarity
4. Keep it simple and intuitive
5. Examples:
   - "A tool that returns a random hex color" -> "getColor"
   - "A tool that compresses image files" -> "compressImage"
   - "A tool that validates JSON data" -> "validateJson"
   - "A tool that generates random numbers" -> "generateNumber"

Return ONLY the action name, nothing else.`;

        const response = await openai.chat([
            { 
                role: 'system', 
                content: 'You are an expert at creating clear, concise function names. Only respond with the exact function name, no explanation.' 
            },
            { role: 'user', content: prompt }
        ], {
            model: 'gpt-4o',
            temperature: 0.2
        });

        const actionName = response.content.trim();

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
}

module.exports = new ToolGenerator();

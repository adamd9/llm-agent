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
            actions: [
                {
                    name: 'generateTool',
                    description: 'Generate a new tool based on natural language description',
                    parameters: [
                        {
                            name: 'description',
                            description: 'Natural language description of the desired tool functionality',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'contextPrompt',
                            description: 'Additional context for example generation',
                            type: 'string',
                            required: false
                        },
                        {
                            name: 'constraints',
                            description: 'Constraints for example generation',
                            type: 'object',
                            required: false
                        },
                        {
                            name: 'context',
                            description: 'Context information about related tools and dependencies',
                            type: 'object',
                            required: false
                        },
                        {
                            name: 'capabilities',
                            description: 'Explicit capabilities definition',
                            type: 'object',
                            required: false
                        },
                        {
                            name: 'save',
                            description: 'Whether to save the tool to data/tools folder',
                            type: 'boolean',
                            required: false
                        }
                    ]
                },
                {
                    name: 'updateTool',
                    description: 'Update an existing tool with new capabilities or examples',
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
                            description: 'Additional context for example generation',
                            type: 'string',
                            required: false
                        }
                    ]
                },
                {
                    name: 'testTool',
                    description: 'Test a tool with provided examples',
                    parameters: [
                        {
                            name: 'toolName',
                            description: 'Name of the tool to test',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'examples',
                            description: 'Test examples to run',
                            type: 'array',
                            required: false
                        }
                    ]
                },
                {
                    name: 'validateTool',
                    description: 'Validate a tool against its capabilities and examples',
                    parameters: [
                        {
                            name: 'toolName',
                            description: 'Name of the tool to validate',
                            type: 'string',
                            required: true
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
        // Generate implementation using LLM
        const prompt = `You are a JavaScript developer tasked with creating a new tool implementation.

Tool Requirements:
1. Tool Name: ${toolName} (must be exactly this)
2. Description: ${description}
3. Capabilities: ${JSON.stringify(capabilities, null, 2)}

The implementation must:
1. Be a complete JavaScript class with the exact name provided
2. Have a constructor that sets this.name and this.description
3. Include getCapabilities() method that returns the exact capabilities object
4. Include an async execute(params) method that handles array-based parameters:
   - Parameters will be passed as an array of {name, value} objects
   - You MUST convert array parameters to object format in execute():
     \`\`\`javascript
     const paramObj = {};
     params.forEach(param => {
         if (param.name && 'value' in param) {
             paramObj[param.name] = param.value;
         }
     });
     \`\`\`
5. Export a singleton instance using module.exports
6. Return results in {success: true/false, data?: any, error?: string} format
7. For EACH parameter:
   - Include type validation (typeof check)
   - Include required validation if parameter.required is true
   - Include the required field in parameter definitions (must be boolean true/false)
   - Include a description field for each parameter

Example test cases:
${JSON.stringify(examples, null, 2)}

Generate only the complete JavaScript class implementation with no explanation or comments.`;

        try {
            // Get LLM client
            const llmClient = getClient('openai');
            
            // Generate implementation
            const response = await llmClient.chat([
                { 
                    role: 'system', 
                    content: 'You are an expert JavaScript developer who writes clean, efficient, and well-documented code.' 
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

            console.log('Generated code:', code);

            // Validate the generated code
            const validationResult = await this._validateGeneratedCode(code, toolName, description, capabilities);
            if (!validationResult.valid) {
                console.error('Code validation failed:', validationResult.reasons);
                throw new Error(`Generated code does not meet requirements: ${validationResult.reasons.join(', ')}`);
            }

            return code;
        } catch (error) {
            throw new Error(`Failed to generate tool implementation: ${error.message}`);
        }
    }

    /**
     * Validate generated code
     * @private
     */
    async _validateGeneratedCode(code, toolName, description, capabilities) {
        const reasons = [];
        try {
            // Basic syntax check
            new Function(code);

            // Check for class definition
            if (!code.includes(`class ${toolName}`)) {
                reasons.push(`Missing class definition for ${toolName}`);
            }

            // Check for constructor
            if (!code.includes('constructor()')) {
                reasons.push('Missing constructor');
            }

            // Check for required properties
            if (!code.includes('this.name') || !code.includes('this.description')) {
                reasons.push('Missing required properties (name or description)');
            }

            // Check for getCapabilities method
            if (!code.includes('getCapabilities()')) {
                reasons.push('Missing getCapabilities method');
            }

            // Check for execute method
            if (!code.includes('execute(')) {
                reasons.push('Missing execute method');
            }

            // Check for module.exports
            if (!code.includes('module.exports')) {
                reasons.push('Missing module.exports');
            }

            // Add validation for array parameter handling
            if (!code.includes('params.forEach') && !code.includes('Array.isArray(params)')) {
                reasons.push('Missing array parameter handling in execute method');
            }

            // Deeper validation by evaluating the code
            try {
                const tempFilename = `temp_${toolName}_${Date.now()}.js`;
                const tempPath = require('path').join(require('os').tmpdir(), tempFilename);
                require('fs').writeFileSync(tempPath, code);

                try {
                    const tempModule = require(tempPath);
                    
                    // Validate name and description
                    if (tempModule.name !== toolName) {
                        reasons.push(`Tool name mismatch: expected ${toolName}, got ${tempModule.name}`);
                    }
                    if (tempModule.description !== description) {
                        reasons.push('Tool description mismatch');
                    }

                    // Validate capabilities
                    const actualCapabilities = tempModule.getCapabilities();
                    
                    // Validate each parameter has required fields
                    const validateParameters = (params) => {
                        return params.every(param => {
                            if (!('required' in param)) {
                                reasons.push(`Parameter ${param.name} is missing the required field`);
                                return false;
                            }
                            // Ensure required is a boolean
                            if (typeof param.required !== 'boolean') {
                                const boolValue = param.required === true || param.required === 'true';
                                reasons.push(`Parameter ${param.name} has required field as ${typeof param.required}, converting to boolean ${boolValue}`);
                                param.required = boolValue;
                            }
                            if (!param.description) {
                                reasons.push(`Parameter ${param.name} is missing description`);
                                return false;
                            }
                            return true;
                        });
                    };

                    actualCapabilities.actions.forEach(action => {
                        validateParameters(action.parameters);
                    });

                    if (!this._compareCapabilities(capabilities, actualCapabilities)) {
                        reasons.push('Capabilities mismatch between expected and actual');
                    }

                    // Validate execute method parameters
                    const executeStr = tempModule.execute.toString();
                    const expectedParams = capabilities.actions[0].parameters;
                    for (const param of expectedParams) {
                        if (!executeStr.includes(`params.${param.name}`)) {
                            reasons.push(`Execute method doesn't handle parameter: ${param.name}`);
                        }
                        if (param.required && !executeStr.includes(`!params.${param.name}`)) {
                            reasons.push(`Missing required parameter check for: ${param.name}`);
                        }
                    }

                    // Test array parameter handling
                    const testParams = capabilities.actions[0].parameters.map(p => ({
                        name: p.name,
                        value: p.type === 'string' ? 'test' : 0
                    }));
                    
                    try {
                        const testResult = tempModule.execute(testParams);
                        // Handle both sync and async execute methods
                        if (testResult instanceof Promise) {
                            await testResult;
                        }
                    } catch (e) {
                        if (e.message.includes('is not iterable') || e.message.includes('forEach')) {
                            reasons.push('Execute method fails to handle array parameters');
                        }
                    }
                } finally {
                    // Clean up temp file
                    require('fs').unlinkSync(tempPath);
                }
            } catch (evalError) {
                reasons.push(`Code evaluation failed: ${evalError.message}`);
            }
        } catch (error) {
            reasons.push(`Invalid JavaScript syntax: ${error.message}`);
        }

        return {
            valid: reasons.length === 0,
            reasons
        };
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
        const toolsDir = path.join(process.cwd(), 'data', 'tools');
        
        // Create tools directory if it doesn't exist
        if (!fs.existsSync(toolsDir)) {
            fs.mkdirSync(toolsDir, { recursive: true });
        }

        const fileName = `${toolName.toLowerCase()}.js`;
        const filePath = path.join(toolsDir, fileName);
        
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

        // Extract the core purpose from the description
        const purposeMatch = description.match(/(?:create|build|make|generate|implement|provide|get|fetch|retrieve|check|validate|process|handle|manage)\s+(?:a|an)?\s*([^.]+)/i);
        const purpose = purposeMatch ? 
            purposeMatch[1].trim() : description;

        // Convert to camel case, keeping only key functional words
        const words = purpose.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => 
                !['a', 'an', 'the', 'to', 'from', 'that', 'which', 'with', 'for'].includes(word) && 
                word.length > 0
            )
            .map(word => word.charAt(0).toUpperCase() + word.slice(1));
        
        if (words.length === 0) {
            throw new Error('Could not generate tool name from description. Description must contain valid words.');
        }

        return words.join('') + 'Tool';
    }

    /**
     * Generate capabilities from description and constraints
     * @private
     */
    _generateCapabilities(description, constraints) {
        // Extract parameters from description using common patterns
        const paramPatterns = [
            // Input parameters
            {regex: /takes(?:\s+a)?(?:\s+required)?\s+([^,\.]+)(?:\s+as(?:\s+(?:a|an|the))?\s+input)?/i, type: 'input'},
            {regex: /accepts(?:\s+a)?\s+([^,\.]+)/i, type: 'input'},
            {regex: /expects(?:\s+a)?\s+([^,\.]+)/i, type: 'input'},
            {regex: /given(?:\s+a)?\s+([^,\.]+)/i, type: 'input'},
            // Output parameters
            {regex: /returns(?:\s+a)?\s+([^,\.]+)/i, type: 'output'},
            {regex: /provides(?:\s+a)?\s+([^,\.]+)/i, type: 'output'},
            {regex: /outputs(?:\s+a)?\s+([^,\.]+)/i, type: 'output'}
        ];

        const params = [];
        const outputs = [];

        // Extract parameters from description
        paramPatterns.forEach(pattern => {
            const match = description.match(pattern.regex);
            if (match) {
                const param = match[1].trim();
                if (pattern.type === 'input') {
                    params.push({
                        name: param.toLowerCase().replace(/\s+/g, '_'),
                        description: `The ${param.toLowerCase()}`,
                        type: this._inferParameterType(param),
                        required: /required|must|should|needs?|mandatory/i.test(description)
                    });
                } else {
                    outputs.push(param);
                }
            }
        });

        // Create action name from core purpose
        const purposeMatch = description.match(/(?:create|build|make|generate|implement|provide|get|fetch|retrieve|check|validate|process|handle|manage)\s+(?:a|an)?\s*([^.]+)/i);
        const actionName = purposeMatch ? 
            purposeMatch[1].toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).join('_') :
            description.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 0).join('_');

        return {
            actions: [{
                name: actionName,
                description: description,
                parameters: params.length > 0 ? params : [{
                    name: 'input',
                    description: 'Input for the tool',
                    type: 'string',
                    required: true
                }]
            }]
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
            console.log('Execute called with:', { actionOrParams, parameters });
            
            // Handle both single object and separate action/parameters format
            let params;
            if (typeof actionOrParams === 'string') {
                // Convert array of parameters to object
                const paramObj = {};
                if (Array.isArray(parameters)) {
                    console.log('Processing array parameters:', parameters);
                    parameters.forEach(param => {
                        if (param.name && 'value' in param) {
                            paramObj[param.name] = param.value;
                        }
                    });
                } else if (parameters && typeof parameters === 'object') {
                    console.log('Processing object parameters:', parameters);
                    Object.assign(paramObj, parameters);
                }
                params = {
                    action: actionOrParams,
                    ...paramObj
                };
            } else if (actionOrParams && typeof actionOrParams === 'object') {
                params = actionOrParams;
            } else {
                throw new Error('Parameters must be provided as an object or action string with parameters');
            }

            console.log('Processed params:', params);

            // Validate basic parameters
            if (!params || typeof params !== 'object') {
                throw new Error('Parameters must be provided as an object');
            }

            const action = params.action || 'generateTool';

            switch (action) {
                // ... existing cases ...

                case 'generateTool': {
                    const {
                        description,
                        contextPrompt,
                        constraints,
                        context,
                        capabilities,
                        save = false
                    } = params;

                    if (!description) {
                        throw new Error('Description is required for generating a tool');
                    }

                    // Generate examples
                    const examples = this.generateExamples(description, contextPrompt, constraints);

                    // Generate tool name from description
                    const toolName = this._generateToolName(description);

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
                        filePath,
                        message: `Tool '${toolName}' generated successfully.`
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

const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class ToolManager {
    constructor() {
        this.tools = new Map();
        this.coreToolsDir = path.join(__dirname);
        this.dataToolsDir = path.join(__dirname, '../../data/tools');
    }

    async loadTools() {
        console.log('Loading tools...');
        // Clear existing tools
        this.tools.clear();

        // Load core tools
        await this.loadToolsFromDirectory(this.coreToolsDir, 'core');

        // Load data tools if they exist
        try {
            await this.loadToolsFromDirectory(this.dataToolsDir, 'data');
        } catch (error) {
            console.log('No custom tools found in data directory');
        }

        console.log('Loaded tools:', Array.from(this.tools.keys()));
        return Array.from(this.tools.values());
    }

    async loadToolsFromDirectory(directory, source) {
        try {
            console.log(`Loading tools from ${directory}`);
            const files = await fs.readdir(directory);
            logger.debug('tools', 'Files in tools directory:', files);
            
            for (const file of files) {
                if (file === 'index.js') continue; // Skip this file
                
                if (file.endsWith('.js')) {
                    const toolPath = path.join(directory, file);
                    try {
                        console.log(`Loading tool from ${file}`);
                        const tool = require(toolPath);
                        if (this.isValidTool(tool)) {
                            tool.source = source;
                            this.tools.set(tool.name, tool);
                            console.log(`Successfully loaded tool: ${tool.name}`);
                        } else {
                            console.log(`Invalid tool in ${file}: missing required properties`);
                        }
                    } catch (error) {
                        console.error(`Error loading tool ${file}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${directory}:`, error);
            throw error;
        }
    }

    isValidTool(tool) {
        console.log('Validating tool:', tool);

        if (!tool || typeof tool !== 'object') {
            console.error('Validation failed: Tool is not an object.');
            return false;
        }
        console.log('Tool is a valid object.');

        if (!tool.name || typeof tool.name !== 'string') {
            console.error('Validation failed: Tool name is missing or not a string.');
            return false;
        }
        console.log('Tool name is valid.');

        if (!tool.description || typeof tool.description !== 'string') {
            console.error('Validation failed: Tool description is missing or not a string.');
            return false;
        }
        console.log('Tool description is valid.');

        if (!tool.execute || typeof tool.execute !== 'function') {
            console.error('Validation failed: Tool execute function is missing or not a function.');
            return false;
        }
        console.log('Tool execute function is valid.');

        if (!tool.getCapabilities || typeof tool.getCapabilities !== 'function') {
            console.error('Validation failed: Tool getCapabilities function is missing or not a function.');
            return false;
        }
        console.log('Tool getCapabilities function is valid.');

        const capabilities = tool.getCapabilities();
        if (!capabilities || !Array.isArray(capabilities.actions)) {
            console.error('Validation failed: Capabilities are missing or actions are not an array.');
            return false;
        }
        console.log('Capabilities are valid.');

        for (const action of capabilities.actions) {
            if (!action.name || typeof action.name !== 'string') {
                console.error('Validation failed: Action name is missing or not a string.');
                return false;
            }
            console.log('Action name is valid.');

            if (!action.description || typeof action.description !== 'string') {
                console.error('Validation failed: Action description is missing or not a string.');
                return false;
            }
            console.log('Action description is valid.');

            if (!Array.isArray(action.parameters)) {
                console.error('Validation failed: Action parameters are not an array.');
                return false;
            }
            console.log('Action parameters are valid.');

            for (const param of action.parameters) {
                if (!param.name || typeof param.name !== 'string') {
                    console.error('Validation failed: Parameter name is missing or not a string.');
                    return false;
                }
                console.log('Parameter name is valid.');

                if (!param.description || typeof param.description !== 'string') {
                    console.error('Validation failed: Parameter description is missing or not a string.');
                    return false;
                }
                console.log('Parameter description is valid.');

                if (!param.type || typeof param.type !== 'string') {
                    console.error('Validation failed: Parameter type is missing or not a string.');
                    return false;
                }
                console.log('Parameter type is valid.');

                if (!['string', 'number', 'boolean', 'object', 'array'].includes(param.type)) {
                    console.error('Validation failed: Parameter type is not valid.');
                    return false;
                }
                console.log('Parameter type is valid.');

                if (param.required === undefined) {
                    console.error('Validation failed: Parameter required is missing.');
                    return false;
                }
                console.log('Parameter required is valid.');
            }
        }

        console.log('All validations passed.');
        return true;
    }

    getTool(name) {
        console.log(`Requesting tool: ${name}`);
        const tool = this.tools.get(name);
        if (!tool) {
            console.log(`Tool not found: ${name}`);
            console.log('Available tools:', Array.from(this.tools.keys()));
        }
        return tool;
    }

    getAllTools() {
        return Array.from(this.tools.values());
    }

    getToolsMetadata() {
        return Array.from(this.tools.values()).map(tool => ({
            name: tool.name,
            description: tool.description,
            source: tool.source,
            parameters: tool.parameters || []
        }));
    }
}

// Singleton instance
const toolManager = new ToolManager();

module.exports = toolManager;

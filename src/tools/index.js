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
            logger.debug('tools', `Loading tools from ${directory}`);
            const files = await fs.readdir(directory);
            logger.debug('tools', 'Files in tools directory:', files);
            
            for (const file of files) {
                if (file === 'index.js') continue; // Skip this file
                
                if (file.endsWith('.js')) {
                    const toolPath = path.join(directory, file);
                    try {
                        logger.debug('tools', `Attempting to load tool from ${file}`);
                        // Clear require cache for data tools to ensure fresh load
                        if (source === 'data') {
                            delete require.cache[require.resolve(toolPath)];
                        }
                        const tool = require(toolPath);
                        logger.debug('tools', `Tool loaded from ${file}:`, {
                            name: tool?.name,
                            description: tool?.description,
                            hasExecute: typeof tool?.execute === 'function',
                            hasCapabilities: typeof tool?.getCapabilities === 'function'
                        });
                        
                        if (this.isValidTool(tool)) {
                            tool.source = source;
                            this.tools.set(tool.name, tool);
                            logger.debug('tools', `Successfully loaded and registered tool: ${tool.name}`);
                        } else {
                            logger.error('tools', `Invalid tool in ${file}: missing required properties`);
                        }
                    } catch (error) {
                        logger.error('tools', `Error loading tool ${file}:`, error);
                    }
                }
            }
        } catch (error) {
            logger.error('tools', `Error reading directory ${directory}:`, error);
            throw error;
        }
    }

    isValidTool(tool) {
        logger.debug('tools', 'Validating tool:', {
            isObject: tool && typeof tool === 'object',
            name: tool?.name,
            description: tool?.description,
            hasExecute: typeof tool?.execute === 'function',
            hasCapabilities: typeof tool?.getCapabilities === 'function'
        });

        if (!tool || typeof tool !== 'object') {
            logger.error('tools', 'Validation failed: Tool is not an object');
            return false;
        }

        if (!tool.name || typeof tool.name !== 'string') {
            logger.error('tools', 'Validation failed: Tool name is missing or not a string');
            return false;
        }

        if (!tool.description || typeof tool.description !== 'string') {
            logger.error('tools', 'Validation failed: Tool description is missing or not a string');
            return false;
        }

        if (!tool.execute || typeof tool.execute !== 'function') {
            logger.error('tools', 'Validation failed: Tool execute function is missing or not a function');
            return false;
        }

        if (!tool.getCapabilities || typeof tool.getCapabilities !== 'function') {
            logger.error('tools', 'Validation failed: Tool getCapabilities function is missing or not a function');
            return false;
        }

        try {
            const capabilities = tool.getCapabilities();
            logger.debug('tools', `Tool ${tool.name} capabilities:`, capabilities);

            if (!capabilities || !Array.isArray(capabilities.actions)) {
                logger.error('tools', 'Validation failed: Capabilities are missing or actions are not an array');
                return false;
            }

            for (const action of capabilities.actions) {
                if (!action.name || typeof action.name !== 'string') {
                    logger.error('tools', 'Validation failed: Action name is missing or not a string');
                    return false;
                }

                if (!action.description || typeof action.description !== 'string') {
                    logger.error('tools', 'Validation failed: Action description is missing or not a string');
                    return false;
                }

                if (!Array.isArray(action.parameters)) {
                    logger.error('tools', 'Validation failed: Action parameters are not an array');
                    return false;
                }
            }

            logger.debug('tools', `Tool ${tool.name} passed all validation checks`);
            return true;
        } catch (error) {
            logger.error('tools', `Error validating tool ${tool?.name}:`, error);
            return false;
        }
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

const fs = require('fs').promises;
const path = require('path');

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
        // Basic tool properties
        if (!tool || typeof tool !== 'object') return false;
        if (!tool.name || typeof tool.name !== 'string') return false;
        if (!tool.description || typeof tool.description !== 'string') return false;
        if (!tool.execute || typeof tool.execute !== 'function') return false;

        // Actions must be defined
        if (!tool.getCapabilities || typeof tool.getCapabilities !== 'function') return false;
        
        const capabilities = tool.getCapabilities();
        if (!capabilities || !Array.isArray(capabilities.actions)) return false;

        // Validate each action
        for (const action of capabilities.actions) {
            if (!action.name || typeof action.name !== 'string') return false;
            if (!action.description || typeof action.description !== 'string') return false;
            if (!Array.isArray(action.parameters)) return false;
            
            // Validate parameters
            for (const param of action.parameters) {
                if (!param.name || typeof param.name !== 'string') return false;
                if (!param.description || typeof param.description !== 'string') return false;
                if (!param.type || typeof param.type !== 'string') return false;
                if (!['string', 'number', 'boolean', 'object', 'array'].includes(param.type)) return false;
                if (param.required === undefined) return false;
            }
        }

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

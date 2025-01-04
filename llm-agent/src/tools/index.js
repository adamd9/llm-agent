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
        return tool && 
               tool.name && 
               tool.description && 
               typeof tool.execute === 'function';
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

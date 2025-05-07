const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const mcpClient = require('./mcpClient');

// Pre-load critical tools to ensure they're always available
const memoryConsolidationTool = require('./memoryConsolidation');

class ToolManager {
    constructor() {
        this.tools = new Map();
        this.coreToolsDir = path.join(__dirname);
        this.dataToolsDir = path.join(__dirname, '../../data/tools');
        this.mcpServersDir = path.join(__dirname, '../../data/mcp-servers');
        this.mcpEnabled = true; // Flag to control MCP integration
    }

    async loadTools() {
        logger.debug('Loading tools...');
        // Clear existing tools
        this.tools.clear();

        // Load core tools
        await this.loadToolsFromDirectory(this.coreToolsDir, 'core');

        // Load data tools if they exist
        try {
            await this.loadToolsFromDirectory(this.dataToolsDir, 'data');
        } catch (error) {
            logger.debug('No custom tools found in data directory');
        }

        // Initialize and load MCP tools if enabled
        if (this.mcpEnabled) {
            try {
                await this.initializeMCPClient();
            } catch (error) {
                logger.error('tools', 'Error initializing MCP client:', {
                    error: error.message,
                    stack: error.stack
                });
            }
        }

        logger.debug('Loaded tools:', Array.from(this.tools.keys()));
        return Array.from(this.tools.values());
    }

    async initializeMCPClient() {
        try {
            logger.debug('tools', 'Initializing MCP client');
            
            // Initialize the MCP client
            await mcpClient.initialize();
            
            // Register the MCP client as a tool
            if (this.isValidTool(mcpClient)) {
                mcpClient.source = 'mcp';
                this.tools.set(mcpClient.name, mcpClient);
                logger.debug('tools', 'Registered MCP client as a tool');
            }
            
            // Load MCP servers
            await this.loadMCPServers();
            
            // Get MCP tools and register them
            await this.registerMCPTools();
            
            logger.debug('tools', 'MCP initialization complete');
        } catch (error) {
            logger.error('tools', 'Error in MCP initialization:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async loadMCPServers() {
        try {
            logger.debug('tools', `Loading MCP servers from ${this.mcpServersDir}`);
            
            // Check if directory exists
            try {
                await fs.access(this.mcpServersDir);
            } catch {
                logger.debug('tools', 'MCP servers directory does not exist, creating it');
                await fs.mkdir(this.mcpServersDir, { recursive: true });
                return; // No servers to load yet
            }
            
            // List server files
            const files = await fs.readdir(this.mcpServersDir);
            logger.debug('tools', 'Files in MCP servers directory:', files);
            
            // Connect to each server
            for (const file of files) {
                if (file.endsWith('.js') || file.endsWith('.py')) {
                    const serverPath = path.join(this.mcpServersDir, file);
                    try {
                        logger.debug('tools', `Connecting to MCP server: ${file}`);
                        await mcpClient.execute('connectServer', {
                            serverPath: serverPath
                        });
                    } catch (error) {
                        logger.error('tools', `Error connecting to MCP server ${file}:`, {
                            error: error.message,
                            stack: error.stack
                        });
                    }
                }
            }
        } catch (error) {
            logger.error('tools', 'Error loading MCP servers:', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    async registerMCPTools() {
        try {
            // Get list of servers
            const result = await mcpClient.execute('listServers', {});
            
            if (result.status !== 'success' || !result.servers) {
                logger.error('tools', 'Failed to get MCP servers list:', result);
                return;
            }
            
            // Create tool adapters for each MCP tool
            for (const server of result.servers) {
                for (const toolName of server.tools) {
                    // Create an adapter for this tool
                    const toolAdapter = this.createMCPToolAdapter(toolName, server.id);
                    
                    // Register the tool adapter
                    if (this.isValidTool(toolAdapter)) {
                        toolAdapter.source = 'mcp';
                        this.tools.set(toolAdapter.name, toolAdapter);
                        logger.debug('tools', `Registered MCP tool: ${toolAdapter.name}`);
                    }
                }
            }
        } catch (error) {
            logger.error('tools', 'Error registering MCP tools:', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    createMCPToolAdapter(toolName, serverId) {
        // Get the tool capabilities from MCP client
        const capabilities = mcpClient.getCapabilities();
        const toolAction = capabilities.actions.find(action => action.name === toolName);
        
        if (!toolAction) {
            logger.error('tools', `Tool action not found for ${toolName}`);
            return null;
        }
        
        // Create a tool adapter
        return {
            name: toolName,
            description: toolAction.description || `MCP Tool: ${toolName}`,
            source: 'mcp',
            serverId,
            
            // Get capabilities method
            getCapabilities() {
                return {
                    actions: [
                        {
                            name: 'execute',
                            description: toolAction.description,
                            parameters: toolAction.parameters
                        }
                    ]
                };
            },
            
            // Execute method
            async execute(action, parameters) {
                if (action !== 'execute') {
                    return {
                        status: 'error',
                        error: `Unknown action: ${action}`
                    };
                }
                
                try {
                    // Call the MCP tool via the MCP client
                    return await mcpClient.execute(toolName, parameters);
                } catch (error) {
                    logger.error('tools', `Error executing MCP tool ${toolName}:`, {
                        error: error.message,
                        stack: error.stack
                    });
                    
                    return {
                        status: 'error',
                        error: `Error executing MCP tool: ${error.message}`
                    };
                }
            }
        };
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
                            logger.error('tools', `Invalid tool in ${file}: missing required properties`, {
                                name: tool?.name,
                                description: tool?.description,
                                hasExecute: typeof tool?.execute === 'function',
                                hasCapabilities: typeof tool?.getCapabilities === 'function'
                            });
                        }
                    } catch (error) {
                        // Log full error details including stack trace
                        logger.error('tools', `Error loading tool ${file}:`, {
                            error: error.message,
                            stack: error.stack,
                            code: error.code,
                            details: error
                        });
                    }
                }
            }
        } catch (error) {
            // Log full error details for directory reading errors
            logger.error('tools', `Error reading directory ${directory}:`, {
                error: error.message,
                stack: error.stack,
                code: error.code,
                details: error
            });
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
        logger.debug(`Requesting tool: ${name}`);
        const tool = this.tools.get(name);
        if (!tool) {
            logger.debug(`Tool not found: ${name}`);
            logger.debug('Available tools:', Array.from(this.tools.keys()));
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

    // Cleanup resources
    async cleanup() {
        if (this.mcpEnabled) {
            try {
                await mcpClient.cleanup();
            } catch (error) {
                logger.error('tools', 'Error cleaning up MCP client:', {
                    error: error.message,
                    stack: error.stack
                });
            }
        }
    }
}

// Singleton instance
const toolManager = new ToolManager();

module.exports = toolManager;

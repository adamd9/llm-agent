/**
 * MCP Tool Manager
 * Manages tools using the Model Context Protocol
 */
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const MCPClient = require('./client');
const sharedEventEmitter = require('../utils/eventEmitter');

class MCPToolManager {
  constructor() {
    this.tools = new Map();
    this.coreToolsDir = path.join(__dirname, '../tools');
    this.dataToolsDir = path.join(__dirname, '../../data/tools');
    this.mcpServersDir = path.join(__dirname, '../../data/mcp-servers');
    this.remoteMcpServersDir = path.join(__dirname, '../../data/remote-mcp-servers'); // Added for remote servers
    this.mcpClient = new MCPClient();
    this._initialized = false;
  }

  /**
   * Initialize the tool manager
   * Loads all tools once during system startup
   * @returns {Promise<Array>} List of loaded tools
   */
  async initialize() {
    // Use static initialization flag to ensure tools are only loaded once
    if (MCPToolManager._globalInitialized) {
      logger.debug('mcpToolManager', 'Tool manager already globally initialized, using cached tools');
      return Array.from(this.tools.values());
    }
    
    if (this._initialized) {
      logger.debug('mcpToolManager', 'Tool manager already initialized, using cached tools');
      return Array.from(this.tools.values());
    }
    
    logger.debug('mcpToolManager', 'Initializing tool manager');
    const tools = await this.loadTools();
    this._initialized = true;
    MCPToolManager._globalInitialized = true;
    logger.debug('mcpToolManager', 'Tool manager initialized with', tools.length, 'tools');
    return tools;
  }

  /**
   * Load all tools
   * @returns {Promise<Array>} List of loaded tools
   */
  async loadTools() {
    logger.debug('mcpToolManager', 'Loading tools...');
    
    // Clear existing tools
    this.tools.clear();
    
    // Initialize MCP client
    await this.mcpClient.initialize();
    
    // Load core tools
    await this.loadToolsFromDirectory(this.coreToolsDir, 'core');
    
    // Load data tools if they exist
    try {
      await this.loadToolsFromDirectory(this.dataToolsDir, 'data');
    } catch (error) {
      logger.debug('mcpToolManager', 'No custom tools found in data directory');
      
      // Emit system error message
      await sharedEventEmitter.emit('systemError', {
        module: 'toolManager',
        content: {
          type: 'system_error',
          error: error.message,
          stack: error.stack,
          location: 'loadTools.loadDataTools',
          status: 'error'
        }
      });
    }
    
    // Load MCP servers
    try {
      await this.loadMCPServers();
    } catch (error) {
      logger.debug('mcpToolManager', 'Error loading MCP servers', { 
        error: error.message,
        stack: error.stack
      });
      
      // Emit system error message
      await sharedEventEmitter.emit('systemError', {
        module: 'toolManager',
        content: {
          type: 'system_error',
          error: error.message,
          stack: error.stack,
          location: 'loadTools.loadMCPServers',
          status: 'error'
        }
      });
    }
    
    logger.debug('mcpToolManager', 'Loaded tools:', Array.from(this.tools.keys()));
    return Array.from(this.tools.values());
  }

  /**
   * Load tools from a directory
   * @param {string} directory - Directory to load tools from
   * @param {string} source - Source of the tools (core or data)
   */
  async loadToolsFromDirectory(directory, source) {
    try {
      logger.debug('mcpToolManager', `Loading tools from ${directory}`);
      const files = await fs.readdir(directory);
      logger.debug('mcpToolManager', 'Files in tools directory:', files);
      
      for (const file of files) {
        if (file === 'index.js' || file === 'mcpClient.js') continue; // Skip these files
        
        if (file.endsWith('.js')) {
          const toolPath = path.join(directory, file);
          try {
            logger.debug('mcpToolManager', `Attempting to load tool from ${file}`);
            // Clear require cache for data tools to ensure fresh load
            if (source === 'data') {
              delete require.cache[require.resolve(toolPath)];
            }
            
            const tool = require(toolPath);
            logger.debug('mcpToolManager', `Tool loaded from ${file}:`, {
              name: tool?.name,
              description: tool?.description,
              hasExecute: typeof tool?.execute === 'function',
              hasCapabilities: typeof tool?.getCapabilities === 'function'
            });
            
            if (this.isValidTool(tool)) {
              tool.source = source;
              this.tools.set(tool.name, tool);
              logger.debug('mcpToolManager', `Successfully loaded and registered tool: ${tool.name}`);
            } else {
              logger.error('mcpToolManager', `Invalid tool in ${file}: missing required properties`, {
                name: tool?.name,
                description: tool?.description,
                hasExecute: typeof tool?.execute === 'function',
                hasCapabilities: typeof tool?.getCapabilities === 'function'
              });
            }
          } catch (error) {
            logger.error('mcpToolManager', `Error loading tool ${file}:`, {
              error: error.message,
              stack: error.stack,
              code: error.code,
              details: error
            });
            
            // Emit system error message
            await sharedEventEmitter.emit('systemError', {
              module: 'toolManager',
              content: {
                type: 'system_error',
                error: error.message,
                stack: error.stack,
                location: `loadToolsFromDirectory.${file}`,
                status: 'error'
              }
            });
          }
        }
      }
    } catch (error) {
      logger.error('mcpToolManager', `Error reading directory ${directory}:`, {
        error: error.message,
        stack: error.stack,
        code: error.code,
        details: error
      });
      
      // Emit system error message
      await sharedEventEmitter.emit('systemError', {
        module: 'toolManager',
        content: {
          type: 'system_error',
          error: error.message,
          stack: error.stack,
          location: `loadToolsFromDirectory.readDir.${directory}`,
          status: 'error'
        }
      });
      
      throw error;
    }
  }

  /**
   * Load MCP servers
   */
  async loadMCPServers() {
    // Load local MCP servers (child processes)
    try {
      logger.debug('mcpToolManager', `Loading local MCP servers from ${this.mcpServersDir}`);
      
      // Check if directory exists
      try {
        await fs.access(this.mcpServersDir);
      } catch {
        logger.debug('mcpToolManager', 'MCP servers directory does not exist, creating it');
        await fs.mkdir(this.mcpServersDir, { recursive: true });
        return; // No servers to load yet
      }
      
      // List server files
      const files = await fs.readdir(this.mcpServersDir);
      logger.debug('mcpToolManager', 'Files in MCP servers directory:', files);
      
      // Connect to each server
      for (const file of files) {
        if (file.endsWith('.js') || file.endsWith('.py')) {
          const serverPath = path.join(this.mcpServersDir, file);
          try {
            logger.debug('mcpToolManager', `Connecting to MCP server: ${file}`);
            const result = await this.mcpClient.connectServer({
              serverPath: serverPath
            });
            
            if (result.status === 'success') {
              logger.debug('mcpToolManager', `Successfully connected to MCP server: ${file}`, result);
              
              // Register tools from this server
              await this.registerMCPServerTools(result.serverId);
            } else {
              logger.error('mcpToolManager', `Failed to connect to MCP server: ${file}`, result);
            }
          } catch (error) {
            logger.error('mcpToolManager', `Error connecting to MCP server ${serverPath}:`, { error: connectionResult.error });
          }
        }
      }
    } catch (error) {
      // Don't throw if the directory doesn't exist, just log it.
      if (error.code === 'ENOENT') {
        logger.debug('mcpToolManager', `Local MCP servers directory not found: ${this.mcpServersDir}`);
      } else {
        logger.error('mcpToolManager', `Error reading local MCP servers directory ${this.mcpServersDir}:`, { 
          error: error.message,
          stack: error.stack
        });
        // Emit system error message for other errors
        await sharedEventEmitter.emit('systemError', {
          module: 'toolManager',
          content: {
            type: 'system_error',
            error: error.message,
            stack: error.stack,
            location: 'loadMCPServers.readLocalDir',
            status: 'error'
          }
        });
      }
    }

    // Load remote MCP servers (HTTP)
    try {
      logger.debug('mcpToolManager', `Loading remote MCP server configurations from ${this.remoteMcpServersDir}`);
      const files = await fs.readdir(this.remoteMcpServersDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const configPath = path.join(this.remoteMcpServersDir, file);
          logger.debug('mcpToolManager', `Found remote MCP server config: ${configPath}`);
          try {
            const configData = await fs.readFile(configPath, 'utf-8');
            const serverConfig = JSON.parse(configData);

            if (!serverConfig.type || serverConfig.type !== 'streamable-http' || !serverConfig.url || !serverConfig.name) {
              logger.error('mcpToolManager', `Invalid remote MCP server config in ${file}: missing type, url, or name.`);
              continue;
            }

            logger.debug('mcpToolManager', `Connecting to remote HTTP MCP server: ${serverConfig.name} at ${serverConfig.url}`);
            // TODO: Implement connectRemoteHttpServer in MCPClient
            const connectionResult = await this.mcpClient.connectRemoteHttpServer(serverConfig);

            if (connectionResult && connectionResult.status === 'success' && connectionResult.tools) {
              logger.debug('mcpToolManager', `Connected to remote HTTP MCP server ${serverConfig.name}, tools:`, connectionResult.tools);
              for (const tool of connectionResult.tools) {
                const adaptedTool = {
                  name: tool.name,
                  description: tool.description,
                  source: `mcp-remote-${serverConfig.name}`,
                  mcpServerId: connectionResult.serverId, // Store serverId for execution
                  getCapabilities: () => {
                    // Construct capabilities from the tool's actions
                    // This assumes tool.actions is an array of action definitions
                    // The 'tool.actions' is already the array of action objects in the desired format.
                    return {
                      name: tool.name,
                      description: tool.description,
                      actions: tool.actions // Use the actions array directly
                    };
                  },
                  execute: async (actionName, params) => {
                    logger.debug('mcpToolManager', `Executing remote MCP tool action: ${tool.name}.${actionName}`);
                    return this.mcpClient.executeTool(tool.name, actionName, params, connectionResult.serverId);
                  }
                };
                if (this.isValidTool(adaptedTool)) {
                  this.tools.set(adaptedTool.name, adaptedTool);
                  logger.debug('mcpToolManager', `Successfully loaded and registered remote MCP tool: ${adaptedTool.name}`);
                } else {
                  logger.error('mcpToolManager', `Invalid adapted remote MCP tool: ${tool.name}`);
                }
              }
            } else {
              logger.error('mcpToolManager', `Error connecting to remote HTTP MCP server ${serverConfig.name}:`, { error: connectionResult?.error });
            }
          } catch (err) {
            logger.error('mcpToolManager', `Error processing remote MCP server config ${file}:`, { error: err.message, stack: err.stack });
            await sharedEventEmitter.emit('systemError', {
              module: 'toolManager',
              content: {
                type: 'system_error',
                error: err.message,
                stack: err.stack,
                location: `loadMCPServers.processRemoteConfig.${file}`,
                status: 'error'
              }
            });
          }
        }
      }
    } catch (error) {
      // Don't throw if the directory doesn't exist, just log it.
      if (error.code === 'ENOENT') {
        logger.debug('mcpToolManager', `Remote MCP servers directory not found: ${this.remoteMcpServersDir}`);
      } else {
        logger.error('mcpToolManager', `Error reading remote MCP servers directory ${this.remoteMcpServersDir}:`, { 
          error: error.message,
          stack: error.stack
        });
        await sharedEventEmitter.emit('systemError', {
          module: 'toolManager',
          content: {
            type: 'system_error',
            error: error.message,
            stack: error.stack,
            location: 'loadMCPServers.readRemoteDir',
            status: 'error'
          }
        });
      }
    }
  }

  /**
   * Register tools from an MCP server
   * @param {string} serverId - Server ID
   */
  async registerMCPServerTools(serverId) {
    try {
      const server = this.mcpClient.getServer(serverId);
      if (!server) {
        logger.error('mcpToolManager', `Server not found: ${serverId}`);
        return;
      }
      
      logger.debug('mcpToolManager', `Registering tools from server ${serverId}`, {
        toolCount: server.tools.length,
        tools: server.tools.map(t => t.name)
      });
      
      // Create tool adapters for each MCP tool
      for (const mcpTool of server.tools) {
        // Create an adapter for this tool
        const toolAdapter = this.createMCPToolAdapter(mcpTool, serverId);
        
        // Register the tool adapter
        if (this.isValidTool(toolAdapter)) {
          toolAdapter.source = 'mcp';
          this.tools.set(toolAdapter.name, toolAdapter);
          logger.debug('mcpToolManager', `Registered MCP tool: ${toolAdapter.name}`);
        } else {
          logger.error('mcpToolManager', `Invalid MCP tool adapter: ${mcpTool.name}`);
        }
      }
    } catch (error) {
      logger.error('mcpToolManager', `Error registering tools from server ${serverId}:`, {
        error: error.message,
        stack: error.stack
      });
      
      // Emit system error message
      await sharedEventEmitter.emit('systemError', {
        module: 'toolManager',
        content: {
          type: 'system_error',
          error: error.message,
          stack: error.stack,
          location: `registerMCPServerTools.${serverId}`,
          status: 'error'
        }
      });
    }
  }

  /**
   * Create a tool adapter for an MCP tool
   * @param {Object} mcpTool - MCP tool
   * @param {string} serverId - Server ID
   * @returns {Object} Tool adapter
   */
  createMCPToolAdapter(mcpTool, serverId) {
    const self = this;
    
    // Create a tool adapter
    return {
      name: mcpTool.name,
      description: mcpTool.description || `MCP Tool: ${mcpTool.name}`,
      source: 'mcp',
      serverId,
      
      // Get capabilities method
      getCapabilities() {
        // Convert MCP input schema to our parameter format
        const parameters = [];
        if (mcpTool.inputSchema && mcpTool.inputSchema.properties) {
          for (const [paramName, paramSchema] of Object.entries(mcpTool.inputSchema.properties)) {
            parameters.push({
              name: paramName,
              description: paramSchema.description || paramName,
              type: paramSchema.type || 'string',
              required: mcpTool.inputSchema.required?.includes(paramName) || false
            });
          }
        }
        
        return {
          actions: [
            {
              name: 'execute',
              description: mcpTool.description || `Execute ${mcpTool.name}`,
              parameters
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
          return await self.mcpClient.callTool(serverId, mcpTool.name, parameters);
        } catch (error) {
          logger.error('mcpToolManager', `Error executing MCP tool ${mcpTool.name}:`, {
            error: error.message,
            stack: error.stack
          });
          
          // Emit system error message
          await sharedEventEmitter.emit('systemError', {
            module: 'toolManager',
            content: {
              type: 'system_error',
              error: error.message,
              stack: error.stack,
              location: `createMCPToolAdapter.execute.${mcpTool.name}`,
              status: 'error'
            }
          });
          
          return {
            status: 'error',
            error: `Error executing MCP tool: ${error.message}`
          };
        }
      }
    };
  }

  /**
   * Check if a tool is valid
   * @param {Object} tool - Tool to validate
   * @returns {boolean} True if valid
   */
  isValidTool(tool) {
    logger.debug('mcpToolManager', 'Validating tool:', {
      isObject: tool && typeof tool === 'object',
      name: tool?.name,
      description: tool?.description,
      hasExecute: typeof tool?.execute === 'function',
      hasCapabilities: typeof tool?.getCapabilities === 'function'
    });

    if (!tool || typeof tool !== 'object') {
      logger.error('mcpToolManager', 'Validation failed: Tool is not an object');
      return false;
    }

    if (!tool.name || typeof tool.name !== 'string') {
      logger.error('mcpToolManager', 'Validation failed: Tool name is missing or not a string');
      return false;
    }

    if (!tool.description || typeof tool.description !== 'string') {
      logger.error('mcpToolManager', 'Validation failed: Tool description is missing or not a string');
      return false;
    }

    if (!tool.execute || typeof tool.execute !== 'function') {
      logger.error('mcpToolManager', 'Validation failed: Tool execute function is missing or not a function');
      return false;
    }

    if (!tool.getCapabilities || typeof tool.getCapabilities !== 'function') {
      logger.error('mcpToolManager', 'Validation failed: Tool getCapabilities function is missing or not a function');
      return false;
    }

    try {
      const capabilities = tool.getCapabilities();
      logger.debug('mcpToolManager', `Tool ${tool.name} capabilities:`, capabilities);

      if (!capabilities || !Array.isArray(capabilities.actions)) {
        logger.error('mcpToolManager', 'Validation failed: Capabilities are missing or actions are not an array');
        return false;
      }

      for (const action of capabilities.actions) {
        if (!action.name || typeof action.name !== 'string') {
          logger.error('mcpToolManager', 'Validation failed: Action name is missing or not a string');
          return false;
        }

        if (!action.description || typeof action.description !== 'string') {
          logger.error('mcpToolManager', 'Validation failed: Action description is missing or not a string');
          return false;
        }

        if (!Array.isArray(action.parameters)) {
          logger.error('mcpToolManager', 'Validation failed: Action parameters are not an array');
          return false;
        }
      }

      logger.debug('mcpToolManager', `Tool ${tool.name} passed all validation checks`);
      return true;
    } catch (error) {
      logger.error('mcpToolManager', `Error validating tool ${tool?.name}:`, {
        error: error.message,
        stack: error.stack
      });
      
      // Emit system error message
      sharedEventEmitter.emit('systemError', {
        module: 'toolManager',
        content: {
          type: 'system_error',
          error: error.message,
          stack: error.stack,
          location: `isValidTool.${tool?.name}`,
          status: 'error'
        }
      });
      
      return false;
    }
  }

  /**
   * Get a tool by name
   * @param {string} name - Tool name
   * @returns {Object} Tool
   */
  getTool(name) {
    logger.debug('mcpToolManager', `Requesting tool: ${name}`);
    const tool = this.tools.get(name);
    if (!tool) {
      logger.debug('mcpToolManager', `Tool not found: ${name}`);
      logger.debug('mcpToolManager', 'Available tools:', Array.from(this.tools.keys()));
    }
    return tool;
  }

  /**
   * Get all tools
   * @returns {Array} All tools
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools metadata
   * @returns {Array} Tools metadata
   */
  getToolsMetadata() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      source: tool.source,
      parameters: tool.parameters || []
    }));
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    try {
      logger.debug('mcpToolManager', 'Cleaning up resources');
      await this.mcpClient.cleanup();
    } catch (error) {
      logger.error('mcpToolManager', 'Error during cleanup', {
        error: error.message,
        stack: error.stack
      });
      
      // Emit system error message
      sharedEventEmitter.emit('systemError', {
        module: 'toolManager',
        content: {
          type: 'system_error',
          error: error.message,
          stack: error.stack,
          location: 'cleanup',
          status: 'error'
        }
      });
    }
  }
}

// Static initialization flag
MCPToolManager._globalInitialized = false;

// Singleton instance
const mcpToolManager = new MCPToolManager();

module.exports = mcpToolManager;

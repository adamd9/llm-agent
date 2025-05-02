/**
 * MCP Client
 * Implements the Model Context Protocol (MCP) client
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

class MCPClient {
  constructor() {
    this.servers = new Map();
    this.toolToServer = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the MCP client
   */
  async initialize() {
    logger.debug('mcpClient', 'Initializing MCP client');
    this.initialized = true;
  }

  /**
   * Connect to an MCP server
   * @param {Object} params - Connection parameters
   * @returns {Promise<Object>} Connection result
   */
  async connectServer(params) {
    try {
      const serverPath = params.serverPath;
      logger.debug('mcpClient', `Connecting to MCP server: ${serverPath}`);
      
      // Validate server path
      if (!serverPath) {
        return {
          status: 'error',
          error: 'Server path is required'
        };
      }
      
      // Check if server exists
      try {
        await fs.access(serverPath);
      } catch {
        return {
          status: 'error',
          error: `Server script not found: ${serverPath}`
        };
      }
      
      // Determine server type
      const isJs = serverPath.endsWith('.js');
      const isPy = serverPath.endsWith('.py');
      
      if (!isJs && !isPy) {
        return {
          status: 'error',
          error: 'Server script must be a .js or .py file'
        };
      }
      
      // Determine command to run
      const command = isPy
        ? process.platform === 'win32' ? 'python' : 'python3'
        : process.execPath;
      
      const args = [serverPath];
      
      // Generate a unique ID for this server
      const serverId = `server_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      
      // Spawn the server process
      logger.debug('mcpClient', `Spawning server process: ${command} ${args.join(' ')}`);
      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });
      
      // Set up communication
      const transport = this.createTransport(proc, serverId);
      
      // Store server information
      this.servers.set(serverId, {
        id: serverId,
        name: path.basename(serverPath, path.extname(serverPath)),
        description: `MCP Server: ${path.basename(serverPath)}`,
        tools: [],
        process: proc,
        transport
      });
      
      // Initialize connection
      await this.initializeConnection(serverId);
      
      // Get server tools
      const tools = await this.fetchServerTools(serverId);
      
      // Register tools
      this.registerServerTools(serverId, tools);
      
      return {
        status: 'success',
        serverId,
        name: this.servers.get(serverId).name,
        toolCount: tools.length,
        tools: tools.map(t => t.name)
      };
    } catch (error) {
      logger.error('mcpClient', 'Failed to connect to MCP server', { 
        error: error.message,
        stack: error.stack
      });
      
      return {
        status: 'error',
        error: `Failed to connect to MCP server: ${error.message}`
      };
    }
  }

  /**
   * Create a transport layer for communicating with the server
   * @param {Object} proc - Child process
   * @param {string} serverId - Server ID
   * @returns {Object} Transport object
   */
  createTransport(proc, serverId) {
    const transport = {
      messageQueue: [],
      messageHandlers: new Map(),
      nextMessageId: 1,
      processExited: false,
      
      // Send a message to the server
      send: async (method, params = {}) => {
        return new Promise((resolve, reject) => {
          // Check if process has exited
          if (transport.processExited) {
            reject(new Error('Cannot send message: Server process has exited'));
            return;
          }
          
          const id = transport.nextMessageId++;
          const message = {
            jsonrpc: '2.0',
            id,
            method,
            params
          };
          
          // Register handler for response
          transport.messageHandlers.set(id, { resolve, reject });
          
          // Send message
          try {
            const messageStr = JSON.stringify(message) + '\n';
            logger.debug('mcpClient', `Sending message to server ${serverId}`, { message });
            proc.stdin.write(messageStr);
          } catch (error) {
            // If we can't write to stdin, the process is probably dead
            transport.messageHandlers.delete(id);
            reject(new Error(`Failed to send message: ${error.message}`));
          }
        });
      }
    };
    
    // Set up event handlers
    let buffer = '';
    
    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      
      // Process complete messages
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const message = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        
        if (message.trim()) {
          try {
            const parsed = JSON.parse(message);
            logger.debug('mcpClient', `Received message from server ${serverId}`, { parsed });
            
            // Handle response
            if (parsed.id !== undefined) {
              const handler = transport.messageHandlers.get(parsed.id);
              if (handler) {
                transport.messageHandlers.delete(parsed.id);
                if (parsed.error) {
                  handler.reject(new Error(parsed.error.message || 'Unknown error'));
                } else {
                  handler.resolve(parsed.result);
                }
              }
            }
          } catch (error) {
            logger.error('mcpClient', `Error processing message from server ${serverId}`, { 
              error, 
              message 
            });
          }
        }
      }
    });
    
    proc.stderr.on('data', (data) => {
      logger.debug('mcpClient', `Server ${serverId} stderr:`, data.toString());
    });
    
    proc.on('error', (error) => {
      logger.error('mcpClient', `Server ${serverId} process error:`, error);
      // Reject all pending messages
      for (const handler of transport.messageHandlers.values()) {
        handler.reject(new Error(`Server process error: ${error.message}`));
      }
      transport.messageHandlers.clear();
    });
    
    // Track if the process has exited
    transport.processExited = false;
    
    proc.on('exit', (code, signal) => {
      logger.debug('mcpClient', `Server ${serverId} process exited with code ${code}, signal ${signal}`);
      
      // Mark the process as exited
      transport.processExited = true;
      
      // Reject all pending messages
      for (const handler of transport.messageHandlers.values()) {
        handler.reject(new Error(`Server process exited with code ${code}`));
      }
      transport.messageHandlers.clear();
      
      // Remove server if it's still registered
      if (this.servers.has(serverId)) {
        this.disconnectServerSync(serverId);
      }
    });
    
    return transport;
  }

  /**
   * Initialize connection with the server
   * @param {string} serverId - Server ID
   * @returns {Promise<Object>} Initialization result
   */
  async initializeConnection(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }
    
    try {
      // Send initialize request
      const result = await server.transport.send('initialize', {
        client: {
          name: 'llm-agent-mcp-client',
          version: '1.0.0'
        },
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      });
      
      logger.debug('mcpClient', `Server ${serverId} initialized:`, result);
      
      // Send initialized notification
      server.transport.send('initialized', {});
      
      return result;
    } catch (error) {
      logger.error('mcpClient', `Failed to initialize server ${serverId}:`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Fetch tools from a server
   * @param {string} serverId - Server ID
   * @returns {Promise<Array>} List of tools
   */
  async fetchServerTools(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }
    
    try {
      // Send listTools request
      const result = await server.transport.send('listTools', {});
      
      logger.debug('mcpClient', `Server ${serverId} tools:`, result);
      
      return result.tools || [];
    } catch (error) {
      logger.error('mcpClient', `Failed to fetch tools from server ${serverId}:`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Register tools from a server
   * @param {string} serverId - Server ID
   * @param {Array} tools - List of tools
   */
  registerServerTools(serverId, tools) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }
    
    // Store tools in server
    server.tools = tools;
    
    // Register tools in lookup map
    for (const tool of tools) {
      this.toolToServer.set(tool.name, serverId);
      logger.debug('mcpClient', `Registered tool ${tool.name} from server ${serverId}`);
    }
  }

  /**
   * Get a server by ID
   * @param {string} serverId - Server ID
   * @returns {Object|undefined} Server or undefined if not found
   */
  getServer(serverId) {
    return this.servers.get(serverId);
  }

  /**
   * Disconnect from an MCP server
   * @param {string} serverId - Server ID
   * @returns {Promise<Object>} Disconnection result
   */
  async disconnectServer(serverId) {
    logger.debug('mcpClient', `Disconnecting from server: ${serverId}`);
    
    const server = this.servers.get(serverId);
    if (!server) {
      return { 
        status: 'error',
        error: `Server not found: ${serverId}` 
      };
    }
    
    try {
      // Unregister tools
      for (const tool of server.tools) {
        this.toolToServer.delete(tool.name);
      }
      
      // Send shutdown request if process is still running
      if (server.process && !server.process.killed && !server.transport.processExited) {
        try {
          await server.transport.send('shutdown', {});
          await server.transport.send('exit', {});
        } catch (error) {
          logger.debug('mcpClient', `Error sending shutdown to server ${serverId}:`, error);
          // Continue with cleanup even if shutdown fails
        }
        
        // Kill process if it's still running
        if (!server.process.killed) {
          server.process.kill();
        }
      }
      
      // Remove server
      this.servers.delete(serverId);
      
      return { 
        status: 'success',
        message: `Disconnected from server: ${serverId}` 
      };
    } catch (error) {
      logger.error('mcpClient', `Error disconnecting from server ${serverId}:`, {
        error: error.message,
        stack: error.stack
      });
      
      // Force cleanup
      this.servers.delete(serverId);
      
      return { 
        status: 'error',
        error: `Error disconnecting from server: ${error.message}`
      };
    }
  }

  /**
   * Disconnect from an MCP server (synchronous version for cleanup)
   * @param {string} serverId - Server ID
   * @returns {Object} Disconnection result
   */
  disconnectServerSync(serverId) {
    logger.debug('mcpClient', `Disconnecting from server (sync): ${serverId}`);
    
    const server = this.servers.get(serverId);
    if (!server) {
      return { 
        status: 'error',
        error: `Server not found: ${serverId}` 
      };
    }
    
    try {
      // Unregister tools
      for (const tool of server.tools) {
        this.toolToServer.delete(tool.name);
      }
      
      // No need to send shutdown/exit as the process is already exited
      
      // Remove server
      this.servers.delete(serverId);
      
      return { 
        status: 'success',
        message: `Disconnected from server: ${serverId}` 
      };
    } catch (error) {
      logger.error('mcpClient', `Error disconnecting from server ${serverId}:`, {
        error: error.message,
        stack: error.stack
      });
      
      // Force cleanup
      this.servers.delete(serverId);
      
      return { 
        status: 'error',
        error: `Error disconnecting from server: ${error.message}`
      };
    }
  }

  /**
   * Call a tool on a server
   * @param {string} serverId - Server ID
   * @param {string} toolName - Tool name
   * @param {Object} parameters - Tool parameters
   * @returns {Promise<Object>} Tool execution result
   */
  async callTool(serverId, toolName, parameters) {
    logger.debug('mcpClient', `Calling tool ${toolName} on server ${serverId}`, { parameters });
    
    const server = this.servers.get(serverId);
    if (!server) {
      return {
        status: 'error',
        error: `Server not found: ${serverId}`
      };
    }
    
    const tool = server.tools.find(t => t.name === toolName);
    if (!tool) {
      return {
        status: 'error',
        error: `Tool not found: ${toolName}`
      };
    }
    
    try {
      // Parse parameters if they're a string
      let parsedParams = parameters;
      if (typeof parameters === 'string') {
        try {
          parsedParams = JSON.parse(parameters);
        } catch (error) {
          logger.error('mcpClient', 'Failed to parse parameters as JSON', { error });
          return {
            status: 'error',
            error: `Invalid parameters: ${error.message}`
          };
        }
      }
      
      // Convert array parameters to object if needed
      let mcpParams = {};
      if (Array.isArray(parsedParams)) {
        for (const param of parsedParams) {
          mcpParams[param.name] = param.value;
        }
      } else if (typeof parsedParams === 'object') {
        mcpParams = parsedParams;
      }
      
      // Call tool
      const result = await server.transport.send('callTool', {
        name: toolName,
        arguments: mcpParams
      });
      
      logger.debug('mcpClient', `Tool ${toolName} result:`, result);
      
      // Return the content directly or wrap it in a success response
      return result.content || {
        status: 'success',
        result: result
      };
    } catch (error) {
      logger.error('mcpClient', `Error calling tool ${toolName}:`, {
        error: error.message,
        stack: error.stack
      });
      return {
        status: 'error',
        error: `Error calling tool ${toolName}: ${error.message}`
      };
    }
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    logger.debug('mcpClient', 'Cleaning up MCP client');
    
    // Disconnect from all servers
    const serverIds = Array.from(this.servers.keys());
    for (const serverId of serverIds) {
      try {
        await this.disconnectServer(serverId);
      } catch (error) {
        logger.error('mcpClient', `Error disconnecting from server ${serverId}:`, {
          error: error.message,
          stack: error.stack
        });
        // If async disconnect fails, try sync disconnect
        this.disconnectServerSync(serverId);
      }
    }
  }
}

module.exports = MCPClient;

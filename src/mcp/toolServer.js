#!/usr/bin/env node

/**
 * Tool Server Adapter
 * Adapts existing tools to the MCP protocol
 */
const path = require('path');
const logger = require('../utils/logger');

class ToolServer {
  constructor() {
    this.initialized = false;
    this.tool = null;
    this.toolPath = null;
  }

  /**
   * Initialize the tool server
   */
  async initialize() {
    try {
      // Get tool path from command line arguments
      this.toolPath = process.argv[2];
      
      if (!this.toolPath) {
        console.error('Tool path not provided');
        process.exit(1);
      }
      
      // Load the tool
      this.tool = require(this.toolPath);
      
      if (!this.tool) {
        console.error(`Failed to load tool from ${this.toolPath}`);
        process.exit(1);
      }
      
      // Set up stdin/stdout handling for STDIO transport
      this.setupStdioTransport();
      
      this.initialized = true;
      console.error(`Tool server initialized for ${this.toolPath}`);
    } catch (error) {
      console.error('Error initializing tool server:', error);
      process.exit(1);
    }
  }

  /**
   * Set up STDIO transport for MCP
   */
  setupStdioTransport() {
    // Handle incoming messages from stdin
    let buffer = '';
    
    process.stdin.on('data', (data) => {
      buffer += data.toString();
      
      // Process complete messages
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const message = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        
        if (message.trim()) {
          this.handleMessage(message);
        }
      }
    });
    
    // Handle process exit
    process.on('exit', () => {
      console.error('Tool server exiting');
    });
  }

  /**
   * Handle an incoming MCP message
   * @param {string} messageStr - JSON-RPC message string
   */
  async handleMessage(messageStr) {
    try {
      const message = JSON.parse(messageStr);
      console.error('Received message:', JSON.stringify(message));
      
      // Handle JSON-RPC message
      if (message.jsonrpc !== '2.0') {
        return this.sendErrorResponse(message.id, -32600, 'Invalid Request: Not a valid JSON-RPC 2.0 message');
      }
      
      // Handle method call
      if (message.method) {
        switch (message.method) {
          case 'initialize':
            return this.handleInitialize(message);
          case 'initialized':
            return this.handleInitialized(message);
          case 'shutdown':
            return this.handleShutdown(message);
          case 'exit':
            return this.handleExit(message);
          case 'listTools':
            return this.handleListTools(message);
          case 'callTool':
            return this.handleCallTool(message);
          default:
            return this.sendErrorResponse(message.id, -32601, `Method not found: ${message.method}`);
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      if (messageStr.id) {
        this.sendErrorResponse(messageStr.id, -32700, `Parse error: ${error.message}`);
      }
    }
  }

  /**
   * Handle initialize request
   * @param {Object} message - JSON-RPC message
   */
  handleInitialize(message) {
    try {
      const clientInfo = message.params?.client || { name: 'unknown', version: '0.0.0' };
      console.error(`Client connected: ${clientInfo.name} v${clientInfo.version}`);
      
      // Send server capabilities
      this.sendResponse(message.id, {
        serverInfo: {
          name: `tool-server-${path.basename(this.toolPath, '.js')}`,
          version: '1.0.0'
        },
        capabilities: {
          tools: {
            supported: true
          },
          resources: {
            supported: false
          },
          prompts: {
            supported: false
          }
        }
      });
    } catch (error) {
      console.error('Error handling initialize:', error);
      this.sendErrorResponse(message.id, -32603, `Internal error: ${error.message}`);
    }
  }

  /**
   * Handle initialized notification
   * @param {Object} message - JSON-RPC message
   */
  handleInitialized(message) {
    console.error('Client initialized');
    // This is a notification, no response needed
  }

  /**
   * Handle shutdown request
   * @param {Object} message - JSON-RPC message
   */
  handleShutdown(message) {
    console.error('Shutdown requested');
    this.sendResponse(message.id, null);
  }

  /**
   * Handle exit notification
   * @param {Object} message - JSON-RPC message
   */
  handleExit(message) {
    console.error('Exit requested');
    // Exit gracefully
    setTimeout(() => {
      process.exit(0);
    }, 100);
  }

  /**
   * Handle listTools request
   * @param {Object} message - JSON-RPC message
   */
  handleListTools(message) {
    try {
      const capabilities = this.tool.getCapabilities();
      const tools = [];
      
      // Convert tool actions to MCP tools
      if (capabilities && Array.isArray(capabilities.actions)) {
        for (const action of capabilities.actions) {
          // Create MCP tool from action
          const mcpTool = {
            name: `${this.tool.name}.${action.name}`,
            description: action.description || `${this.tool.name} ${action.name} action`,
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          };
          
          // Convert parameters to MCP input schema
          if (action.parameters && Array.isArray(action.parameters)) {
            for (const param of action.parameters) {
              mcpTool.inputSchema.properties[param.name] = {
                type: param.type || 'string',
                description: param.description || param.name
              };
              
              if (param.required) {
                mcpTool.inputSchema.required.push(param.name);
              }
            }
          }
          
          tools.push(mcpTool);
        }
      }
      
      this.sendResponse(message.id, {
        tools
      });
    } catch (error) {
      console.error('Error handling listTools:', error);
      this.sendErrorResponse(message.id, -32603, `Internal error: ${error.message}`);
    }
  }

  /**
   * Handle callTool request
   * @param {Object} message - JSON-RPC message
   */
  async handleCallTool(message) {
    try {
      const { name, arguments: args } = message.params;
      
      if (!name) {
        return this.sendErrorResponse(message.id, -32602, 'Invalid params: Missing tool name');
      }
      
      // Parse tool name to get action
      const [toolName, actionName] = name.split('.');
      
      if (!toolName || !actionName) {
        return this.sendErrorResponse(message.id, -32602, 'Invalid params: Tool name must be in format "toolName.actionName"');
      }
      
      if (toolName !== this.tool.name) {
        return this.sendErrorResponse(message.id, -32602, `Tool not found: ${toolName}`);
      }
      
      // Convert MCP arguments to tool parameters format
      const parameters = this.convertMCPArgsToToolParams(args);
      
      // Execute the tool action
      console.error(`Executing tool: ${toolName}.${actionName}`, { parameters });
      const result = await this.tool.execute(actionName, parameters);
      
      // Send the result
      this.sendResponse(message.id, {
        content: result
      });
    } catch (error) {
      console.error('Error handling callTool:', error);
      this.sendErrorResponse(message.id, -32603, `Error executing tool: ${error.message}`);
    }
  }

  /**
   * Convert MCP arguments to tool parameters format
   * @param {Object} args - MCP arguments
   * @returns {Array} Tool parameters
   */
  convertMCPArgsToToolParams(args) {
    if (!args) return [];
    
    // Convert from MCP object format to tool parameter array format
    const params = [];
    
    for (const [name, value] of Object.entries(args)) {
      params.push({
        name,
        value
      });
    }
    
    return params;
  }

  /**
   * Send a JSON-RPC response
   * @param {string|number} id - Message ID
   * @param {Object} result - Response result
   */
  sendResponse(id, result) {
    const response = {
      jsonrpc: '2.0',
      id,
      result
    };
    
    this.sendMessage(response);
  }

  /**
   * Send a JSON-RPC error response
   * @param {string|number} id - Message ID
   * @param {number} code - Error code
   * @param {string} message - Error message
   * @param {Object} data - Additional error data
   */
  sendErrorResponse(id, code, message, data) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data
      }
    };
    
    this.sendMessage(response);
  }

  /**
   * Send a message to the client
   * @param {Object} message - Message to send
   */
  sendMessage(message) {
    const messageStr = JSON.stringify(message) + '\n';
    process.stdout.write(messageStr);
  }
}

// Start the server
const server = new ToolServer();
server.initialize().catch(error => {
  console.error('Failed to initialize tool server:', error);
  process.exit(1);
});

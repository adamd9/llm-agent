/**
 * MCP Client
 * Implements the Model Context Protocol (MCP) client
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

// SDK components will be dynamically imported
let ClientSDK, StreamableHTTPClientTransportSDK;

async function ensureSDKLoaded() {
  if (!ClientSDK || !StreamableHTTPClientTransportSDK) {
    try {
      ClientSDK = (await import('@modelcontextprotocol/sdk/client/index.js')).Client;
      StreamableHTTPClientTransportSDK = (await import('@modelcontextprotocol/sdk/client/streamableHttp.js')).StreamableHTTPClientTransport;
      logger.debug('mcpClient', 'Successfully loaded @modelcontextprotocol/sdk components.');
    } catch (error) {
      logger.error('mcpClient', 'Failed to load @modelcontextprotocol/sdk components:', error);
      throw new Error('MCP SDK components could not be loaded. Ensure @modelcontextprotocol/sdk is installed.');
    }
  }
}

class MCPClient {
  constructor() {
    this.servers = new Map();
    this.toolToServer = new Map();
    this.initialized = false;
  }

  /**
   * Get a server instance by its ID
   * @param {string} serverId - The ID of the server to retrieve
   * @returns {Object|undefined} The server object or undefined if not found
   */
  getServer(serverId) {
    return this.servers.get(serverId);
  }

  /**
   * Initialize the MCP client
   */
  async initialize() {
    logger.debug('mcpClient', 'Initializing MCP client');
    this.initialized = true;
  }

  /**
   * Connect to a remote HTTP MCP server
   * @param {Object} serverConfig - Server configuration (url, name, description, type, note)
   * @returns {Promise<Object>} Connection result
   */
  async connectRemoteHttpServer(serverConfig) {
    await ensureSDKLoaded(); // Ensure SDK is loaded
    try {
      logger.debug('mcpClient', `Connecting to remote HTTP MCP server: ${serverConfig.name} at ${serverConfig.url}`);

      if (!serverConfig || !serverConfig.url || !serverConfig.name || serverConfig.type !== 'streamable-http') {
        return {
          status: 'error',
          error: 'Invalid remote server configuration provided.'
        };
      }

      const serverId = `remote_sdk_http_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      const sdkClient = new ClientSDK({
        name: `llm-agent-mcp-client-for-${serverConfig.name}`,
        version: '1.0.0' // Consider making this dynamic or configurable
      });

      const sdkTransport = new StreamableHTTPClientTransportSDK(
        new URL(serverConfig.url)
      );

      logger.debug('mcpClient', `Attempting to connect SDK client to ${serverConfig.name} at ${serverConfig.url}`);
      await sdkClient.connect(sdkTransport);
      logger.debug('mcpClient', `SDK client connected successfully to ${serverConfig.name}`);

      this.servers.set(serverId, {
        id: serverId,
        name: serverConfig.name,
        description: serverConfig.description || `Remote HTTP MCP Server: ${serverConfig.name}`,
        url: serverConfig.url,
        type: 'http-sdk', // Mark as SDK-managed
        sdkClient: sdkClient, // Store the SDK client instance
        tools: []
      });

      // Fetch tools using the SDK client
      logger.debug('mcpClient', `Fetching tools from ${serverConfig.name} using SDK client`);
      const toolListResponse = await sdkClient.listTools(); // Use the specific listTools method
      if (!toolListResponse || !Array.isArray(toolListResponse.tools)) {
        logger.error('mcpClient', 'Invalid tool/list response from SDK-connected server', { response: toolListResponse });
        throw new Error('Invalid tool/list response from SDK-connected server.');
      }
      const sdkTools = toolListResponse.tools;
      logger.debug('mcpClient', `Received ${sdkTools.length} tools from ${serverConfig.name} via SDK.`);

      const agentFormattedTools = sdkTools.map(sdkTool => {
        const schemaToParameters = (schema) => {
          if (!schema || typeof schema !== 'object' || !schema.properties || typeof schema.properties !== 'object') {
            logger.debug('mcpClient', `Tool '${sdkTool.name}': Invalid or missing inputSchema.properties, cannot derive parameters. Input schema:`, schema);
            return [];
          }
          return Object.entries(schema.properties).map(([propName, propDetails = {}]) => ({
            name: propName,
            type: propDetails.type || 'any',
            description: propDetails.description || '',
            required: Array.isArray(schema.required) && schema.required.includes(propName)
          }));
        };

        return {
          name: sdkTool.name,
          description: sdkTool.description,
          inputSchema: sdkTool.inputSchema,
          outputSchema: sdkTool.outputSchema,
          actions: [{
            name: 'execute',
            description: sdkTool.description, // Reuse tool description for the main action
            parameters: schemaToParameters(sdkTool.inputSchema)
          }]
        };
      });

      this.registerServerTools(serverId, agentFormattedTools);

      return {
        status: 'success',
        serverId,
        name: this.servers.get(serverId).name,
        toolCount: this.servers.get(serverId).tools.length,
        // MCPToolManager expects tools with name, description, and actions array
        tools: this.servers.get(serverId).tools.map(t => ({ 
          name: t.name, 
          description: t.description, 
          actions: t.actions // These are now the agent-formatted actions
        }))
      };

    } catch (error) {
      logger.error('mcpClient', `Failed to connect to remote HTTP MCP server ${serverConfig.name}:`, {
        error: error.message,
        stack: error.stack
      });
      return {
        status: 'error',
        error: `Failed to connect to remote HTTP MCP server ${serverConfig.name}: ${error.message}`
      };
    }
  }

  /**
   * Connect to an MCP server (stdio)
   * @param {Object} params - Connection parameters (serverPath)
   * @returns {Promise<Object>} Connection result
   */
  async connectServer(params) {
    try {
      const serverPath = params.serverPath;
      logger.debug('mcpClient', `Connecting to MCP server: ${serverPath}`);
      
      if (!serverPath) {
        return {
          status: 'error',
          error: 'Server path is required'
        };
      }
      
      try {
        await fs.access(serverPath);
      } catch {
        return {
          status: 'error',
          error: `Server script not found: ${serverPath}`
        };
      }
      
      const isJs = serverPath.endsWith('.js');
      const isPy = serverPath.endsWith('.py');
      
      if (!isJs && !isPy) {
        return {
          status: 'error',
          error: 'Server script must be a .js or .py file'
        };
      }
      
      const command = isPy
        ? process.platform === 'win32' ? 'python' : 'python3'
        : process.execPath;
      
      const args = [serverPath];
      
      const serverId = `server_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      
      logger.debug('mcpClient', `Spawning server process: ${command} ${args.join(' ')}`);
      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      });

      const transport = {
        send: (method, params) => {
          return new Promise((resolve, reject) => {
            const id = `msg_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            const message = {
              jsonrpc: '2.0',
              id: id,
              method: method,
              params: params
            };
            
            logger.debug('mcpClient', `Sending message to server ${serverId}:`, message);
            proc.stdin.write(JSON.stringify(message) + '\n');
            
            let responseBuffer = '';
            const onData = (data) => {
              responseBuffer += data.toString();
              // Try to process complete JSON objects from the buffer
              let boundary = responseBuffer.indexOf('\n');
              while (boundary !== -1) {
                const responseStr = responseBuffer.substring(0, boundary).trim();
                responseBuffer = responseBuffer.substring(boundary + 1);
                if (responseStr) {
                  logger.debug('mcpClient', `Received line from server ${serverId}: ${responseStr}`);
                  try {
                    const response = JSON.parse(responseStr);
                    if (response.id === id) {
                      logger.debug('mcpClient', `Matching response for ID ${id}:`, response);
                      cleanupListeners(); // Use centralized cleanup
                      if (response.error) {
                        logger.error('mcpClient', `Error response from server ${serverId}:`, response.error);
                        reject(new Error(response.error.message || JSON.stringify(response.error)));
                      } else {
                        resolve(response.result);
                      }
                      return; // Found our response
                    } else {
                      logger.debug('mcpClient', `Response ID ${response.id} does not match expected ${id}.`);
                    }
                  } catch (e) {
                    logger.error('mcpClient', `Error parsing response from server ${serverId}: ${e.message}. Data: "${responseStr}"`);
                  }
                }
                boundary = responseBuffer.indexOf('\n');
              }
            };

            const onErrorData = (data) => {
                const errorStr = data.toString().trim();
                logger.error('mcpClient', `Stderr from server ${serverId}: ${errorStr}`);
            };
            
            const requestTimeout = setTimeout(() => {
              logger.error('mcpClient', `Timeout waiting for response from server ${serverId} for message ID ${id}`);
              cleanupListeners();
              reject(new Error(`Timeout waiting for response from server ${serverId} for message ID ${id}`));
            }, 30000);

            const cleanupListeners = () => {
                proc.stdout.removeListener('data', onData);
                proc.stderr.removeListener('data', onErrorData);
                clearTimeout(requestTimeout);
            };

            proc.stdout.on('data', onData);
            proc.stderr.on('data', onErrorData);
          });
        }
      };
      
      this.servers.set(serverId, {
        id: serverId,
        name: path.basename(serverPath),
        description: `MCP Server: ${serverPath}`,
        path: serverPath,
        proc: proc,
        transport: transport,
        type: 'stdio',
        tools: []
      });

      logger.debug('mcpClient', `Performing handshake with server ${serverId} by calling listTools`);
      try {
        const response = await transport.send('listTools', {});
        const tools = response?.tools || response;
        if (!Array.isArray(tools)) {
            logger.error('mcpClient', `Handshake failed: listTools did not return an array for server ${serverId}. Response:`, response);
            proc.kill();
            this.servers.delete(serverId);
            return { status: 'error', error: 'Handshake failed: listTools did not return an array.' };
        }
        logger.debug('mcpClient', `Handshake successful with ${serverId}. Received tools:`, tools);
        this.registerServerTools(serverId, tools);
      } catch (handshakeError) {
        logger.error('mcpClient', `Handshake failed with server ${serverId}:`, handshakeError);
        proc.kill();
        this.servers.delete(serverId);
        return { status: 'error', error: `Handshake failed: ${handshakeError.message}` };
      }
      
      proc.on('exit', (code, signal) => {
        logger.debug('mcpClient', `Server ${serverId} exited with code ${code}, signal ${signal}`);
        this.servers.delete(serverId);
        this.toolToServer.forEach((sId, toolName) => {
          if (sId === serverId) {
            this.toolToServer.delete(toolName);
          }
        });
      });
      
      proc.on('error', (err) => {
        logger.error('mcpClient', `Failed to start server ${serverId}: ${err.message}`);
        this.servers.delete(serverId);
      });

      return {
        status: 'success',
        serverId: serverId,
        name: this.servers.get(serverId)?.name,
        toolCount: this.servers.get(serverId)?.tools.length || 0
      };
    } catch (error) {
      logger.error('mcpClient', `Error in connectServer for ${params.serverPath}:`, {
        error: error.message,
        stack: error.stack
      });
      return {
        status: 'error',
        error: `Failed to connect to server ${params.serverPath}: ${error.message}`
      };
    }
  }

  /**
   * Call a tool on a server
   * @param {string} serverId - Server ID
   * @param {string} toolName - Tool name
   * @param {Object|string} parameters - Tool parameters
   * @returns {Promise<Object>} Tool execution result
   */
  async callTool(serverId, toolName, parameters) {
    logger.debug('mcpClient', `Calling tool ${toolName} on server ${serverId}`, { parameters });

    const server = this.servers.get(serverId);
    if (!server) {
      return { status: 'error', error: `Server not found: ${serverId}` };
    }

    const tool = server.tools.find(t => t.name === toolName);
    if (!tool) {
      return { status: 'error', error: `Tool not found: ${toolName}` };
    }

    try {
      let parsedParams = parameters;
      if (typeof parameters === 'string') {
        try {
          parsedParams = JSON.parse(parameters);
        } catch (error) {
          logger.error('mcpClient', 'Failed to parse parameters as JSON', { error });
          return { status: 'error', error: `Invalid parameters: ${error.message}` };
        }
      }

      let mcpParams = {};
      if (Array.isArray(parsedParams)) {
        for (const param of parsedParams) {
          mcpParams[param.name] = param.value;
        }
      } else if (parsedParams && typeof parsedParams === 'object') {
        mcpParams = parsedParams;
      } else {
        logger.warn('mcpClient', `Unexpected parameter format for tool ${toolName}. Parameters:`, parsedParams);
        mcpParams = parsedParams || {};
      }

      if (server.type === 'http-sdk' && server.sdkClient) {
        logger.debug('mcpClient', `Calling tool ${toolName} via SDK on server ${serverId}`, { parameters: mcpParams });
        // Format parameters correctly for the SDK callTool method
        const sdkCallParams = { name: toolName, arguments: mcpParams };
        const sdkResponse = await server.sdkClient.callTool(sdkCallParams);
        logger.debug('mcpClient', `Full SDK response from server ${serverId} for tool ${toolName}:`, sdkResponse);

        if (sdkResponse && typeof sdkResponse[Symbol.asyncIterator] === 'function') {
          // Handle streaming response
          let accumulatedOutput = '';
          try {
            for await (const chunk of sdkResponse) {
              if (chunk.error) {
                logger.error('mcpClient', `Streaming chunk error for tool ${toolName} on server ${serverId}:`, chunk.error);
                return { status: 'error', error: chunk.error.message || JSON.stringify(chunk.error) };
              }
              if (typeof chunk.output === 'string') {
                accumulatedOutput += chunk.output;
              }
              if (chunk.isDone) break;
            }
            return { status: 'success', result: accumulatedOutput };
          } catch (streamError) {
            logger.error('mcpClient', `Error processing streaming response for ${toolName} on server ${serverId}:`, { error: streamError.message, stack: streamError.stack });
            return { status: 'error', error: `Error processing streaming response: ${streamError.message}` };
          }
        } else if (sdkResponse) {
          // Handle non-streaming response
          if (sdkResponse.error) {
            logger.error('mcpClient', `SDK response for tool ${toolName} on server ${serverId} contained an error:`, sdkResponse.error);
            return { status: 'error', error: sdkResponse.error.message || JSON.stringify(sdkResponse.error) };
          }

          let finalResult;
          if (sdkResponse.content && Array.isArray(sdkResponse.content) && sdkResponse.content.length > 0) {
            const firstContent = sdkResponse.content[0];
            if (firstContent && firstContent.type === 'text' && typeof firstContent.text === 'string') {
              try {
                finalResult = JSON.parse(firstContent.text);
                logger.debug('mcpClient', `Successfully parsed JSON from sdkResponse.content[0].text for tool ${toolName} on server ${serverId}`);
              } catch (parseError) {
                logger.error('mcpClient', `Failed to parse JSON from sdkResponse.content[0].text for tool ${toolName} on server ${serverId}. Raw text: '${firstContent.text}'. Error: ${parseError.message}`);
                finalResult = firstContent.text; // Fallback to raw text if parsing fails
              }
            } else {
              logger.warn('mcpClient', `sdkResponse.content[0] for tool ${toolName} on server ${serverId} not in expected format {type: 'text', text: 'string'}. Checking sdkResponse.output. Content[0]:`, firstContent);
              finalResult = sdkResponse.output; // Fallback to output if content[0] is not as expected
            }
          } else if (sdkResponse.output !== undefined) {
            logger.debug('mcpClient', `Using sdkResponse.output for tool ${toolName} on server ${serverId} as sdkResponse.content was not suitable or absent.`);
            finalResult = sdkResponse.output;
          } else {
            logger.warn('mcpClient', `Neither sdkResponse.content nor sdkResponse.output provided usable data for tool ${toolName} on server ${serverId}. Full response:`, sdkResponse);
            // If there's no error, but no discernible data, return the whole sdkResponse as a fallback, or an empty object.
            // This situation implies the server responded successfully but sent an unusual payload.
            finalResult = sdkResponse; // Or consider returning an empty object or a specific 'no data' indicator.
          }
          return { status: 'success', result: finalResult };
        } else {
          logger.error('mcpClient', `Invalid or empty response from SDK callTool for ${toolName} on server ${serverId}. sdkResponse:`, sdkResponse);
          return { status: 'error', error: 'Invalid or empty response from SDK callTool' };
        }
      } else if (server.transport) {
        // For stdio servers, use the transport
        logger.debug('mcpClient', `Calling tool ${toolName} via transport on server ${serverId}`, { parameters: mcpParams });
        const result = await server.transport.send('callTool', { name: toolName, arguments: mcpParams });
        // The transport.send for 'callTool' is expected to return the direct result or an object with a 'content' field.
        // If result.content exists, use that, otherwise assume 'result' itself is the payload.
        if (result && result.content !== undefined) {
            return { status: 'success', result: result.content };
        }
        return { status: 'success', result: result }; // Fallback if no 'content' field
      } else {
        return { status: 'error', error: `Server ${serverId} not configured for tool execution.` };
      }
    } catch (error) {
      logger.error('mcpClient', `Error calling tool ${toolName} on server ${serverId}:`, { error: error.message, stack: error.stack });
      return { status: 'error', error: `Error calling tool ${toolName}: ${error.message}` };
    }
  }

  // ... (other methods remain the same)
  registerServerTools(serverId, tools) {
    logger.debug('mcpClient', `Registering ${tools.length} tools from server ${serverId}`);
    const server = this.servers.get(serverId);
    if (!server) {
      logger.error('mcpClient', `Cannot register tools: Server ${serverId} not found`);
      return;
    }

    server.tools = tools.map(tool => ({
      ...tool,
      serverId: serverId
    }));

    // Register tools in the tool-to-server mapping
    tools.forEach(tool => {
      this.toolToServer.set(tool.name, serverId);
    });

    logger.debug('mcpClient', `Registered ${server.tools.length} tools from server ${serverId}`);
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

// Note on "streamable-http":
// The current implementation for 'streamable-http' uses standard HTTP POST requests
// for each MCP message (initialize, getTools, execute). If a true streaming protocol
// (like Server-Sent Events or newline-delimited JSON over a long-lived connection)
// is intended, the createHttpTransport method would need to be significantly modified
// to handle such a stream. For now, it assumes a request-response pattern per call.

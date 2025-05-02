# MCP Implementation Guide

This guide provides specific implementation details following the project's established rules and patterns.

## 1. Tool Interface Implementation

### MCPServerTool Class
```javascript
/**
 * @typedef {Object} MCPToolParameter
 * @property {string} name - Parameter name
 * @property {string} description - Parameter description
 * @property {string} type - Parameter type (string, number, boolean, object, array)
 * @property {boolean} required - Whether parameter is required
 */

/**
 * @typedef {Object} MCPTool
 * @property {string} name - Tool name
 * @property {string} description - Tool description
 * @property {Array<MCPToolParameter>} parameters - Tool parameters
 */

/**
 * @typedef {Object} MCPServer
 * @property {string} name - Server name
 * @property {string} description - Server description
 * @property {Array<MCPTool>} tools - Server tools
 * @property {ChildProcess} process - Node.js child process
 */

/**
 * Tool for managing MCP servers and routing tool executions
 * @implements {Tool}
 */
class MCPServerTool {
    /** @type {string} */
    name = 'mcpServer';

    /** @type {string} */
    description = 'Manages MCP server tools';

    /** @type {Map<string, MCPServer>} */
    servers = new Map();

    /** @type {Object} */
    serverInfo = {
        tools: []
    };

    /**
     * Load an MCP server from file
     * @param {string} serverPath - Path to server file
     * @returns {Promise<void>}
     * @throws {Error} If server fails to load
     */
    async loadServer(serverPath) {
        // Implementation
    }

    /**
     * Execute a tool action
     * @param {string} action - Tool action name
     * @param {Object} parameters - Tool parameters
     * @returns {Promise<Object>} Tool execution result
     * @throws {Error} If execution fails
     */
    async execute(action, parameters) {
        // Implementation
    }

    /**
     * Get tool capabilities
     * @returns {Object} Tool capabilities
     */
    getCapabilities() {
        // Implementation
    }

    /**
     * Clean up resources
     * @returns {Promise<void>}
     */
    async cleanup() {
        // Implementation
    }
}
```

## 2. Architecture Integration

### Tool Manager Integration
```javascript
// tools/index.js
class ToolManager {
    async loadTools() {
        // Initialize MCP Server Tool first
        this.mcpServerTool = new MCPServerTool();
        this.tools.set(this.mcpServerTool.name, this.mcpServerTool);

        // Load MCP servers
        await this.loadMCPServers();

        // Load other tools...
    }
}
```

### Coordinator Integration
```javascript
// coordinator.js
async function executePlan(plan, toolActions) {
    for (const step of plan.steps) {
        // Handle MCP tool actions same as other tools
        const result = await toolManager.execute(step.action, step.parameters);
        // Process result...
    }
}
```

## 3. Error Handling

### Error Types
```javascript
class MCPServerError extends Error {
    constructor(message, serverName, originalError) {
        super(message);
        this.name = 'MCPServerError';
        this.serverName = serverName;
        this.originalError = originalError;
    }
}

class MCPToolError extends Error {
    constructor(message, toolName, parameters, originalError) {
        super(message);
        this.name = 'MCPToolError';
        this.toolName = toolName;
        this.parameters = parameters;
        this.originalError = originalError;
    }
}
```

### Error Handling Pattern
```javascript
async function execute(action, parameters) {
    try {
        // Validate parameters
        this.validateParameters(action, parameters);

        // Find target server
        const server = this.findServerForAction(action);
        if (!server) {
            throw new MCPToolError(`No server found for action: ${action}`);
        }

        // Execute with retries
        return await this.executeWithRetry(server, action, parameters);
    } catch (error) {
        logger.error('mcpServerTool', `Error executing ${action}:`, error);
        throw new MCPToolError(
            `Failed to execute ${action}: ${error.message}`,
            action,
            parameters,
            error
        );
    }
}
```

## 4. Testing

### Unit Tests
```javascript
// __tests__/mcpServerTool.test.js
describe('MCPServerTool', () => {
    let tool;
    let mockServer;

    beforeEach(() => {
        tool = new MCPServerTool();
        mockServer = {
            name: 'test',
            description: 'Test server',
            tools: [{
                name: 'test.add',
                description: 'Add numbers',
                parameters: [{
                    name: 'a',
                    type: 'number',
                    required: true
                }, {
                    name: 'b',
                    type: 'number',
                    required: true
                }]
            }]
        };
    });

    test('loads server successfully', async () => {
        // Test implementation
    });

    test('executes tool action', async () => {
        // Test implementation
    });

    test('handles server errors', async () => {
        // Test implementation
    });
});
```

## 5. WebSocket Communication

### Message Types
```typescript
interface MCPMessage {
    type: 'register' | 'execute' | 'response' | 'error';
    data: any;
}

interface MCPRegisterMessage extends MCPMessage {
    type: 'register';
    data: {
        name: string;
        description: string;
        tools: Array<MCPTool>;
    }
}

interface MCPExecuteMessage extends MCPMessage {
    type: 'execute';
    data: {
        action: string;
        parameters: Object;
    }
}

interface MCPResponseMessage extends MCPMessage {
    type: 'response';
    data: {
        result: any;
        error?: string;
    }
}
```

### Message Handling
```javascript
class MCPServer {
    constructor() {
        process.on('message', async (message) => {
            try {
                await this.handleMessage(message);
            } catch (error) {
                process.send({
                    type: 'error',
                    data: {
                        error: error.message,
                        stack: error.stack
                    }
                });
            }
        });
    }

    async handleMessage(message) {
        switch (message.type) {
            case 'execute':
                const result = await this.execute(
                    message.data.action,
                    message.data.parameters
                );
                process.send({
                    type: 'response',
                    data: { result }
                });
                break;
            // Handle other message types...
        }
    }
}
```

## 6. File System Organization

```
src/
  mcp-servers/     # Core MCP servers (read-only)
    calculator.js
    weather.js
  tools/
    mcpServerTool.js
    index.js
  lib/
    mcpServer.js   # Base MCP server class
data/
  mcp-servers/     # Custom MCP servers (read-write)
    custom1.js
    custom2.js
```

## 7. Validation

### Parameter Validation
```javascript
/**
 * Validate tool parameters
 * @param {string} action - Tool action name
 * @param {Object} parameters - Parameters to validate
 * @throws {Error} If validation fails
 */
validateParameters(action, parameters) {
    const tool = this.findToolByAction(action);
    if (!tool) {
        throw new Error(`Unknown tool action: ${action}`);
    }

    for (const param of tool.parameters) {
        if (param.required && !(param.name in parameters)) {
            throw new Error(
                `Missing required parameter: ${param.name} for action: ${action}`
            );
        }

        if (param.name in parameters) {
            const value = parameters[param.name];
            if (typeof value !== param.type) {
                throw new Error(
                    `Invalid type for parameter: ${param.name}. Expected: ${param.type}, got: ${typeof value}`
                );
            }
        }
    }
}
```

## 8. Configuration

### Environment Variables
```javascript
// config.js
module.exports = {
    MCP: {
        MAX_RETRIES: 5,
        RETRY_DELAY: 1000,
        PING_INTERVAL: 30000,
        STARTUP_TIMEOUT: 5000,
        MAX_SERVERS: 10
    }
};
```

## 9. Logging

### Log Levels
```javascript
// mcpServerTool.js
const logger = require('../utils/logger');

// Debug level for development
logger.debug('mcpServerTool', 'Loading server', { path });

// Info level for normal operations
logger.info('mcpServerTool', 'Server registered', { name });

// Error level for failures
logger.error('mcpServerTool', 'Server failed', { error });
```

# MCP (Model Context Protocol) Implementation

This directory contains the implementation of the Model Context Protocol (MCP) for the LLM Agent. The MCP protocol allows tools to be loaded and accessed via a standardized interface, enabling better interoperability and extensibility.

## Components

### MCP Client (`client.js`)

The MCP Client is responsible for:
- Connecting to MCP servers
- Discovering tools provided by MCP servers
- Executing tool actions via the MCP protocol
- Managing server lifecycle (initialization, shutdown)

### MCP Tool Manager (`toolManager.js`)

The MCP Tool Manager integrates with the existing tool infrastructure and:
- Loads tools from core and data directories
- Loads MCP servers from the `data/mcp-servers` directory
- Creates adapters for MCP tools to make them compatible with the existing tool interface
- Provides a unified interface for accessing all tools (both regular and MCP)

### MCP Index (`index.js`)

The index file exports the MCP Tool Manager for easy import in other modules.

## MCP Servers

MCP servers are standalone processes that expose tools via the MCP protocol. They can be written in any language that supports the MCP protocol, but this implementation focuses on JavaScript/Node.js servers.

MCP servers should be placed in the `data/mcp-servers` directory and can be:
- JavaScript files (`.js`) - Will be executed with Node.js
- Python files (`.py`) - Will be executed with Python

## Usage

To use the MCP implementation, simply import the MCP Tool Manager:

```javascript
const toolManager = require('./mcp');

// Load all tools (both regular and MCP)
const tools = await toolManager.loadTools();

// Get a specific tool
const tool = toolManager.getTool('toolName');

// Execute a tool action
const result = await tool.execute('actionName', parameters);
```

## Testing

A test script is provided in `scripts/test-mcp-integration.js` to verify that the MCP infrastructure is working correctly. Run it with:

```bash
node scripts/test-mcp-integration.js
```

You can also test a specific MCP server by providing its path:

```bash
node scripts/test-mcp-integration.js ./data/mcp-servers/calculator.js
```

## Example MCP Server

An example MCP server (`calculator.js`) is provided in the `data/mcp-servers` directory. It implements basic arithmetic operations and demonstrates how to create an MCP server.

## Future Enhancements

- Support for remote MCP servers
- Support for MCP resources and prompts
- More comprehensive error handling and recovery
- Improved logging and debugging

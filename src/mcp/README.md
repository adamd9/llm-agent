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

MCP servers are processes or services that expose tools via the Model Context Protocol. They can be local scripts or remote HTTP services.

### Local MCP Servers
Local MCP servers are scripts executed as child processes. They should be placed in the `data/mcp-servers` directory and can be:
- JavaScript files (`.js`) - Will be executed with Node.js
- Python files (`.py`) - Will be executed with Python

### Remote HTTP MCP Servers
Support has been added for connecting to remote MCP servers over HTTP. These servers are expected to expose a single HTTP endpoint that accepts JSON-RPC 2.0 messages via POST requests.

Configuration for remote servers should be placed as individual `.json` files in the `data/remote-mcp-servers` directory. Each file should define a server, for example:

```json
{
    "type": "streamable-http",
    "url": "http://127.0.0.1:3001/mcp",
    "name": "CalendarRetriever",
    "description": "MCP Server for Calendar Retrieval via HTTP",
    "note": "Calendar retriever (Remote HTTP)"
}
```

- `type`: Must be `"streamable-http"` for this type of server.
- `url`: The HTTP endpoint for the remote MCP server.
- `name`: A unique name for this server instance.
- `description` (optional): A brief description of the server.
- `note` (optional): Any additional notes.

Currently, "streamable-http" is implemented as a series of individual HTTP POST requests for each MCP command (e.g., initialize, getTools, execute). True streaming (e.g., Server-Sent Events) would require further modifications.

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

- **Advanced Remote MCP Features**: Enhancements to remote MCP server support, such as true streaming capabilities (e.g., Server-Sent Events, WebSockets) for `streamable-http` type, and support for other remote protocols.
- **MCP Resources and Prompts**: Full implementation for MCP resources and prompts.
- **Error Handling and Recovery**: More comprehensive error handling, especially for remote connections, including retries and more detailed diagnostics.
- **Logging and Debugging**: Improved logging and debugging capabilities for MCP interactions.

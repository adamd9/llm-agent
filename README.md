# LLM Agent

An AI agent powered by GPT-4o-mini that can engage in natural conversation and execute tasks using tools.

## Architecture

The system consists of three main components:

### 1. Ego Layer
- Handles natural language conversation
- Determines when a message requires tools vs. simple conversation
- Maintains agent identity and capabilities
- Uses GPT-4o-mini for natural language understanding
- Manages task retry attempts based on evaluation results
- Communicates progress and adjustments to the user
- Updated the event handling logic to utilize the `handleBubble` function for `bubble` events.

### 2. Coordinator Layer
- Receives tasks from the ego layer when tools are needed
- Plans task execution using the planner
- Executes plans using available tools
- Returns results and evaluation metrics to the ego layer
- Provides detailed error handling with:
  - Full stack traces
  - Step-by-step execution status
  - Contextual error information
  - Tool-specific error details
  - System error tracking across all modules

#### System Error Tracking
The application includes a comprehensive system error tracking mechanism:

1. **Error Collection**: All errors across modules are captured with:
   - Module name and location
   - Specific component that triggered the error (e.g., which module exceeded a token limit)
   - Full error message and stack trace
   - Error context and status
   - Timestamp of occurrence

2. **Unified Error Interface**: 
   - All errors are emitted through a standardized "systemError" message type
   - Errors are displayed in a dedicated UI component
   - Errors are preserved across sessions for debugging

3. **Error Visualization**:
   - Dedicated "System Errors" button in the header
   - Real-time error count updates
   - Detailed error information in modal view
   - Visual highlighting for new errors

4. **Error Categories**:
   - Execution errors (coordinator)
   - Planning errors (planner)
   - Evaluation errors (evaluator)
   - Tool execution errors (toolManager)
   - Client communication errors (llmClient)

This system provides comprehensive visibility into application errors, making debugging and troubleshooting more efficient.

#### Task Evaluation System
The system evaluates task outcomes to ensure quality:

1. **Initial Planning**: Create a plan based on the original request
2. **Execution**: Execute the plan using available tools
3. **Evaluation**: Assess results against intended outcomes
   - Compare execution output with original request context
   - Generate a match percentage score (0-100%)
   - Provide specific recommendations for improvements
4. **Result Processing**: 
   - Return evaluation results to ego layer:
     - Match percentage score
     - Execution output
     - Improvement recommendations
     - Success/failure indicators
   - Ego layer decides next steps:
     - If score >= threshold: Present results to user
     - If score < threshold: 
       - Inform user of adjustment attempt
       - Incorporate recommendations
       - Request new plan with adjustments
5. **Retry Control**:
   - Maximum 5 attempts per task
   - Each attempt includes user feedback
   - Final result presented even if threshold not met
   - User kept informed of progress

This feedback system allows for iterative improvement while maintaining user engagement and transparency throughout the process.

### 3. Tool Layer
- Provides specific capabilities (e.g., file operations, web searches). These tools are managed by the `MCPToolManager` (`src/mcp/toolManager.js`) and can originate from several sources:
  - **Local JavaScript Tools:** Standardized JavaScript modules loaded dynamically from the `src/tools/` (core system tools) and `data/tools/` (custom user-defined tools) directories.
  - **Local MCP Servers (Stdio-based):** External processes (e.g., Python or Node.js scripts) that adhere to the Model Context Protocol and communicate via standard input/output. These are configured through definition files in the `data/mcp-servers/` directory.
  - **Remote MCP Servers (HTTP SDK-based):** External MCP servers accessed over HTTP, typically leveraging the `@modelcontextprotocol/sdk`. These are configured through definition files in the `data/remote-mcp-servers/` directory.
- Each tool, regardless of its source, is registered with the `MCPToolManager` and presents a standardized interface to the agent, including its name, description, and parameters.
- **MCP Client (`src/mcp/client.js`) Features:** The MCP client is responsible for the low-level communication with different types of MCP servers. Its key features include:
  - Connection management for local stdio-based MCP servers (typically scripts running as child processes).
  - Connection management for remote MCP servers via HTTP, utilizing the `@modelcontextprotocol/sdk` for standardized communication and handling of streaming responses.
  - Robust parsing of tool parameters, accommodating JSON strings, direct objects, or arrays.
  - Consistent error reporting from tool invocations across different server types.
- **Parameter Handling for Tools:**
  - Tools (and the mechanisms invoking them) are designed to be flexible with parameter formatting, accepting both stringified JSON and direct JavaScript objects/arrays.
  - Clear error messages are provided for invalid parameters.
  - Sensible defaults are used where appropriate.
  - The system does not assume perfect parameter formatting from the LLM or other callers.

#### Tool Interface Validation
The system uses a hybrid approach combining JSDoc type definitions and JSON Schema validation to ensure tool interface consistency without requiring full TypeScript adoption:

##### Core Components

1. **JSDoc Type Definitions**
   - Provides development-time type checking in IDEs
   - Generates documentation automatically
   - Defines standard tool interfaces and types
   ```javascript
   /**
    * @typedef {Object} ToolParameter
    * @property {string} name
    * @property {string} description
    * @property {('string'|'number'|'boolean'|'array'|'object')} type
    * @property {boolean} required
    */

   /**
    * @typedef {Object} Tool
    * @property {string} name
    * @property {string} description
    * @property {function(): Object} getCapabilities
    * @property {function(string, any[]): Promise<Object>} execute
    ```
   ```javascript
   /**
    * @typedef {Object} ToolParameter
    * @property {string} name
    * @property {string} description
    * @property {('string'|'number'|'boolean'|'array'|'object')} type
    * @property {boolean} required
    */

   /**
    * @typedef {Object} Tool
    * @property {string} name
    * @property {string} description
    * @property {function(): Object} getCapabilities
    * @property {function(string, any[]): Promise<Object>} execute
    ```

2. **JSON Schema Validation**
   - Runtime validation of tool interfaces
   - Validates tool structure and parameter types
   - Provides detailed error messages
   - Used by Tool Generator for validation
   - OpenAI API response format requirements:
     - Must include `name` property in JSON schema
     - Uses `json_schema` format for response validation
     - Enforces strict type checking and required fields

3. **Validation Rules**
   - All tools must implement the standard interface
   - Required properties: name, description, getCapabilities, execute
   - getCapabilities must return properly structured actions
   - Parameters must specify name, type, description, and required status
   - Execute method must handle both stringified and object parameters

4. **Development Workflow**
   - Tools can be created manually or via Tool Generator
   - Interface validation occurs during development and runtime
   - Clear error messages guide developers to fix interface issues
   - Documentation automatically generated from JSDoc comments

This validation system ensures consistency and reliability while maintaining flexibility and ease of development.

#### Tool Generator
The Tool Generator is a specialized tool for creating new tools within the system. It leverages the agent's capabilities to understand natural language descriptions and generate appropriate test cases.

##### Core Capabilities
1. **Natural Language Processing**
   - Processes natural language descriptions of desired tool functionality
   - Extracts key parameters, actions, and requirements
   - Generates formal tool specifications

2. **Example Generation**
   - Agent analyzes tool description to generate realistic test cases
   - Creates diverse input scenarios covering edge cases
   - Provides expected outputs for validation
   - Supports both simple and complex data structures

3. **Tool Validation**
   - Ensures compliance with tool interface requirements
   - Validates parameter types and requirements
   - Verifies proper method implementation
   - Checks documentation completeness

4. **Template Generation**
   - Creates standardized tool code structure
   - Implements required methods (execute, getCapabilities)
   - Generates parameter validation
   - Adds error handling and logging

5. **Documentation Generation**
   - Creates JSDoc comments
   - Generates usage examples
   - Documents parameters and types
   - Provides capability descriptions

6. **Dependency Management**
   - Uses only approved dependencies to ensure reliability:
     - Native Node.js modules (fs, path, etc)
     - Native fetch API for HTTP requests
     - Already imported modules from relative paths
   - Provides clear guidance on HTTP request patterns
   - Implements progressive retry strategies with different approaches
   - Validates tool functionality without external dependencies

##### Interface
```typescript
interface ToolGeneratorParams {
  description: string;           // Natural language description of tool
  contextPrompt?: string;       // Additional context for example generation
  constraints?: {               // Optional constraints for example generation
    inputTypes?: string[];      // Expected input data types
    outputTypes?: string[];     // Expected output data types
    complexity?: 'simple' | 'moderate' | 'complex';
    coverage?: string[];        // Specific cases to cover
  };
  context?: {                   // Optional context information
    relatedTools?: string[];    // Related tool names
    dependencies?: string[];    // Required dependencies
    tags?: string[];           // Categorization tags
  };
  capabilities?: {              // Optional explicit capabilities
    actions?: {
      name: string;
      description: string;
      parameters: Parameter[];
    }[];
  };
}

interface GeneratedExample {
  input: any;
  expectedOutput: any;
  description: string;          // Explanation of what this example tests
  coverage: string[];          // What aspects this example covers
}
```

##### Usage Example
```javascript
const result = await toolGenerator.execute({
  description: "Create a tool that can compress images while maintaining quality",
  contextPrompt: "Focus on common image formats like JPEG and PNG, with quality settings",
  constraints: {
    inputTypes: ['file', 'number'],
    outputTypes: ['file'],
    complexity: 'moderate',
    coverage: ['quality_settings', 'file_formats', 'error_handling']
  },
  context: {
    relatedTools: ["fileSystem"],
    dependencies: ["sharp"],
    tags: ["image", "compression"]
  }
});
```

The tool will automatically generate appropriate test examples based on the description and constraints, such as:
```javascript
{
  examples: [
    {
      input: { path: "image.jpg", quality: 0.8 },
      expectedOutput: { success: true, newPath: "image-compressed.jpg" },
      description: "Standard JPEG compression with good quality",
      coverage: ["quality_settings", "jpeg_format"]
    },
    {
      input: { path: "image.png", quality: 0.9 },
      expectedOutput: { success: true, newPath: "image-compressed.png" },
      description: "PNG compression with high quality retention",
      coverage: ["quality_settings", "png_format"]
    },
    {
      input: { path: "nonexistent.jpg", quality: 0.8 },
      expectedOutput: { success: false, error: "File not found" },
      description: "Error handling for missing input file",
      coverage: ["error_handling"]
    }
  ]
}
```

### Conversations Tool
- A new tool has been added in `src/tools/conversations.js` to handle conversations generically.
- The tool includes methods for `request`, `response`, `getCapabilities`, and `execute`.
- The `request` method utilizes the system prompt from `Ego.buildSystemPrompt` and an appropriate user prompt.

## API Endpoints

The agent uses WebSocket for real-time, bidirectional communication:

### WebSocket Connection
- Connect to `ws://<host>` to establish a WebSocket connection
- Upon connection, you'll receive a session ID message:
  ```json
  {
    "type": "session",
    "sessionId": "unique-session-id"
  }
  ```

### Message Types

1. **Client to Server**
   - Send messages in this format:
     ```json
     {
       "message": "your message",
       "sessionId": "your-session-id"
     }
     ```

2. **Server to Client**
   - **Session Message**:
     ```json
     {
       "type": "session",
       "sessionId": "unique-session-id"
     }
     ```
   - **Response Message**:
     ```json
     {
       "type": "response",
       "data": {
         "response": "agent's response",
         "format": "text|markdown|code",
         "language": "javascript|python|etc",
         "metadata": {}
       }
     }
     ```
   - **Working Status Message**:
     ```json
     {
       "type": "working",
       "data": {
         "status": "current status message"
       }
     }
     ```
   - **Debug Message**:
     ```json
     {
       "type": "debug",
       "data": {
         "context": "debug context",
         "message": "debug message",
         "data": { /* debug data */ },
         "timestamp": "ISO timestamp"
       }
     }
     ```
   - **Error Message**:
     ```json
     {
       "type": "error",
       "error": "error message",
       "details": {
         "message": "detailed error message",
         "timestamp": "ISO timestamp"
       }
     }
     ```

### Session History
- `GET /chat/:sessionId/history`: Get chat history for a session
  - Response: Array of messages in the session

## Logging System

The system includes a comprehensive logging mechanism that captures all console output and stores it in session files:

### Key Features

- **Session-Based Logging**: Each user session gets its own log file with a unique session ID
- **Timestamped Files**: Log files are named with ISO datetime stamps (e.g., `2025-05-02T14-21-24_session_[id].json`)
- **Structured Format**: All logs include timestamps, message type, and formatted data
- **WebSocket Integration**: Debug and error messages are sent to connected clients via WebSocket
- **Direct Console Output**: All logs are displayed in the console for real-time monitoring

### Log File Structure

```json
{
  "sessionId": "session-uuid",
  "messages": [
    {
      "timestamp": "2025-05-02T04:21:25.738Z",
      "type": "stdout",
      "data": {
        "level": "log",
        "message": ["[logger] Message context: Message content", {}]
      }
    }
  ]
}
```

## Development

### Prerequisites
- Node.js 18+
- Docker and Docker Compose

### Quick Start

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with your OpenAI API key:
```
OPENAI_API_KEY=your_key_here
```

3. Run with Docker Compose:
```bash
docker-compose up --build
```

## Configuration

### Data Directory

The application uses a `data` directory to store various files, including custom tools, personalities, MCP server configurations, memory files, and temporary logs. The location of this directory can be configured using an environment variable. **If the specified or default data directory does not exist at startup, the application will attempt to create it.**

-   **`LLM_AGENT_DATA_DIR`**: Set this environment variable to an **absolute path** to specify the location of the data directory.
    -   If this variable is set and points to a valid absolute path, the application will use that directory.
    -   If this variable is not set, or if it's set to a relative path or an invalid path, the application will default to using the `data` folder located in the project's root directory (i.e., `PROJECT_ROOT/data`).

This allows for flexibility in deploying or managing the agent's data, for example, by placing it on a different volume or a shared location if needed.


## Development

The application runs in development mode by default, which includes:
- Hot reloading using nodemon
- Automatic restart when files in `src` directory change
- Debug logging enabled
- Log files stored in `data/logs` with timestamps

To run in production mode, set `NODE_ENV=production` in the environment variables.

### Development Mode
During development, the application will automatically:
- Detect changes to any files in the `src` directory
- Restart the Node.js process (not the container)
- Create a new timestamped log file
- Maintain a symlink to the current log at `data/logs/current.log`

You don't need to restart the container to see your changes - just edit and save your files.

### Project Structure

```
.
├── src/                  # Source code
├── data/                 # Data directory
│   ├── logs/            # Application logs
│   └── personalities/   # Personality definition files
├── scripts/             # Utility scripts
└── tests/               # Test files
```

### Initialization

On startup, the system automatically:
1. Creates required directories if they don't exist (`data/logs`, `data/personalities`)
2. Creates a default personality (HK-47) if none exists
3. Sets up logging with timestamp-based rotation

### Logging

The system uses a unified logging system that:
- Provides consistent debug information across all modules
- Automatically broadcasts debug info to connected WebSocket clients
- Includes timestamps and context with all messages
- Supports structured data logging

Debug messages follow this format:
```json
{
  "context": "module:operation",
  "message": "Human readable message",
  "data": {
    "relevant": "debug data",
    "timestamp": "ISO timestamp"
  }
}
```

These messages are:
1. Logged to the console for development
2. Sent to all connected WebSocket clients with type "debug"
3. Stored in rotating log files under `data/logs/`

### Development Scripts

#### Deploy Container and Run Tests

We have a helper script to deploy the container and run tests:

```bash
# Make the script executable
chmod +x scripts/deploy.sh

# Run the deploy script
./scripts/deploy.sh
```

This script will:
1. Stop existing containers
2. Rebuild and start containers
3. Run all tests
4. Show test results and container status

⚠️ **Important**: Always run this script after making changes to:
- Any JavaScript files
- Environment variables
- Docker configuration

The script will show test results and help catch any issues early.

### Setup
1. Clone the repository
2. Create a `.env` file with your OpenAI API key:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```
3. Run with Docker Compose:
   ```bash
   docker-compose up --build
   ```

4. After the first run, edit `data/settings.json` to customize runtime options.
   Set `maxTokens` to control the default token limit for LLM responses.

### Testing
Run the test suite:
```bash
npm test
```

#### Testing OpenAI Implementations
When testing components that use the OpenAI API, follow these best practices:

1. **Mock the OpenAI Client**:
   ```javascript
   jest.mock('openai');
   
   const mockOpenAI = {
     chat: {
       completions: {
         create: jest.fn()
       }
     }
   };
   ```

2. **Inject the Mock Client**:
   - Design your components to accept a client parameter
   - Fall back to creating a real client if none is provided
   ```javascript
   function MyComponent(config, client = null) {
     this.client = client || new OpenAI(config);
   }
   ```

3. **Structure Mock Responses**:
   - Match the exact structure of OpenAI API responses
   - Include all required fields
   ```javascript
   mockOpenAI.chat.completions.create.mockResolvedValueOnce({
     choices: [{
       message: {
         content: JSON.stringify({
           // your mock response data
         })
       }
     }]
   });
   ```

4. **Validate Response Handling**:
   - Test both successful and error scenarios
   - Verify proper parsing of response content
   - Check error handling for malformed responses

5. **Reset Mocks Between Tests**:
   ```javascript
   beforeEach(() => {
     jest.clearAllMocks();
   });
   ```

## Design Principles

### Real-time Communication
- WebSocket-based communication for instant responses
- Bidirectional streaming of messages and debug information
- Automatic reconnection handling for network interruptions
- Session-based conversation history

### Error Handling
- Graceful error handling at all layers
- Detailed error messages with timestamps and context
- Debug information streaming for development
- Proper cleanup of resources and connections

### Testing
- Independent test instances for reliable testing
- No shared state between tests
- Fast test execution (sub-second)
- Comprehensive WebSocket connection testing
- Session management verification

### Code Organization
- Clear separation of concerns between layers
- Modular WebSocket message handling
- Consistent message type definitions
- Clean session and connection management

### Flat File Configuration
The system follows a flat file configuration approach for extensible components:

1. **Tool System**: Tools are loaded dynamically from:
   - Core tools in `src/tools/`
   - Custom tools in `data/tools/`
   - Each tool is a JavaScript module with defined interface

2. **Personality System**: Agent personalities are defined as plain text prompts:
   - Core personalities in `src/personalities/*.txt`
   - Custom personalities in `data/personalities/*.txt`
   - Filename (minus extension) is the personality name
   - File content is the raw personality prompt
   - First personality found is used as default
   - System capabilities (conversation, tasks) are independent of personality

This design allows for:
- Easy addition and modification of components through simple file operations
- Clear separation between core and custom components
- Version control friendly structure
- Simple text-based configuration
- No complex configuration management

### Adding Custom Personalities

To add a new personality:

1. Create a new `.txt` file in `data/personalities/`
   - Filename will be the personality name (e.g., `friendly.txt`)
2. Write the raw personality prompt in the file:
   ```
   You are a friendly and approachable coding assistant...
   [rest of personality prompt]
   ```
3. The personality will be automatically loaded on next startup
4. If it's the only personality file present, it will become the default

### System Architecture

The system is designed with clear separation of concerns:

1. **Ego Layer**: Core agent behavior
   - Handles conversation and task routing
   - Loads personality from flat files
   - System capabilities are built-in (conversation, tasks)
   - Personality only affects the agent's communication style

2. **Tool Layer**: Extensible capabilities
   - Tools are loaded dynamically
   - Each tool is a separate module
   - Clear interface definition
   - Easy to add new tools

3. **Configuration**: Flat file based
   - No complex configuration management
   - Text files for personalities
   - JavaScript modules for tools
   - Easy to version and modify

## Architecture Details

### Message Flow
1. User sends a message
2. Ego processes the message:
   - If it's conversation → Responds directly
   - If it requires tools → Enriches with context and sends to coordinator
3. Coordinator (for tool-based tasks):
   - Plans the steps needed
   - Executes the plan using available tools
   - Returns results
4. Response sent back to user

### Tool Management
- Tools are loaded dynamically from the `src/tools` directory
- Each tool must export:
  - `name`: Tool identifier
  - `description`: What the tool does
  - `execute()`: Function to run the tool
  - `getCapabilities()`: Function that returns tool's actions and parameters

### File System Operations
The file system tool provides access to files in two directories:
- `/usr/src/app/data`: Read-write directory for data files
- `/usr/src/app/src`: Read-only directory for source code

Features:
- Supports relative paths (e.g., "config.json" instead of "/usr/src/app/data/config.json")
- Defaults to data directory when no path is specified
- Automatically resolves paths to the appropriate directory
- Prevents access to files outside of allowed directories

Actions:
- `list`: List files in a directory (defaults to data directory)
- `read`: Read a file from either directory
- `write`: Write to a file (data directory only)
- `delete`: Delete a file (data directory only)
- `exists`: Check if a file exists

#### Permissions Requirements
The data directory requires specific permissions to function correctly:
- Directory permissions: `777` (rwxrwxrwx)
  - All users need read/write/execute permissions
  - Execute permission is needed to list directory contents
- File permissions: `666` (rw-rw-rw-)
  - All users need read/write permissions
  - Files are created with these permissions by default

These permissions ensure that:
1. The Node.js process in the container can read/write files
2. The host user can read/write files
3. The directory is accessible for listing and file creation

You can set these permissions using:
```bash
chmod 777 data      # Set directory permissions
chmod 666 data/*    # Set file permissions
```

### Error Handling

The system provides comprehensive error handling at multiple levels:

1. **Coordinator Errors**
   - Invalid tool or action errors
   - Plan execution failures
   - JSON parsing errors
   - Each error includes:
     - Error message
     - Full stack trace
     - Failed step details
     - Tool response (if available)

2. **Tool Errors**
   - File operation failures
   - Permission issues
   - Validation errors
   - Each error includes:
     - Error message
     - Stack trace
     - Operation parameters
     - File paths (when relevant)

3. **Response Format**
   For any error, the response will have this structure:
   ```json
   {
     "status": "error",
     "error": "Error message",
     "stack": "Full stack trace",
     "details": {
       "error": "Detailed error message",
       "stack": "Stack trace",
       "lastStep": "Failed step info",
       "toolResponse": "Tool-specific error details"
     }
   }
   ```

### Session Management
- Each chat session has a unique ID
- Session history is maintained for context
- History can be retrieved via API

## Memory Management

### Memory Format with Consolidated Tags

The memory system now uses a clean, consolidated tag format to handle multi-line memory content. This enhancement improves readability and parsing reliability for both humans and LLMs.

- All memory content is now enclosed within `<MEMORY>` and `</MEMORY>` tags
- Metadata is included as attributes in the opening tag
- Memory entries follow this format:
  ```
  <MEMORY module="category" timestamp="1234567890" [context="optional_context"]>
  Multi-line memory content goes here.
  It can span multiple lines without breaking the structure.
  Code blocks and other formatted content are preserved intact.
  </MEMORY>
  ```

This consolidated format replaces the previous mixed format that used both brackets and XML-like tags:
```
[category][timestamp]
<MEMORY_CONTENT>
Content here
</MEMORY_CONTENT>
```

### Reflection Process

The reflection step now examines the most recent short‑term memory and uses the LLM to generate insights, lessons learned, and follow‑up questions. Each reflection is based on the current conversation history and the results are stored in long‑term memory for later use.

Example reflection output:
```
{
  "insights": [ ... ],
  "lessons_learned": [ ... ],
  "follow_up_questions": [ ... ]
}
```

### Memory Storage and Retrieval
- The `storeLongTerm` and `storeShortTerm` methods automatically format content with the consolidated tags
- The `parseMemoryContent` method uses regex pattern matching to extract memory content and attributes
- The system maintains backward compatibility with legacy memory formats
- The `retrieveLongTerm` method formats memories with the consolidated tags when sending them to the LLM for relevance analysis

#### Reset Memory Functionality

The `resetMemory` function allows the user to reset the current memory by transferring all contents from `current.txt` to `for_long_term.txt`. After the transfer, `current.txt` will be cleared to start fresh. This function is essential for managing long-term memory and ensuring that the current memory reflects only the most relevant information.

### Changes in Functionality
- The `retrieveLongTerm` method now defaults the `context` parameter to 'ego' if it is null, ensuring consistent behavior when retrieving long-term memory.
- When retrieving, any available short-term memory is appended to the question so that long-term memory results account for recent conversation context.

## Updates

- Removed extraneous properties from the `response_format` in `memory.js`, retaining only the `category` property for a more streamlined response schema.
- **Corrected the category assignment in `memory.js` to correctly extract the `name` from the `category` object in the response format.**
- **Added clear memory content delimiters to improve parsing and readability of multi-line memory content.**
- **Enhanced the memory format with consolidated tags that include metadata as attributes, simplifying the structure and improving readability.**

## Shared Event System

A shared event system has been implemented using Node.js's built-in `events` module. This allows various modules to emit and listen for events.

### Usage

To use the shared event system, import the `sharedEventEmitter` from `src/eventEmitter.js`:

```javascript
const sharedEventEmitter = require('./eventEmitter');
```

You can listen for events using:

```javascript
sharedEventEmitter.on('eventName', (data) => {
    console.log('Event received:', data);
});
```

And emit events using:

```javascript
await sharedEventEmitter.emit('eventName', { key: 'value' });
```

This system allows for better modularity and decoupling of components within the application.

## Tool Interface

Each tool in the system must implement the following interface:

```javascript
interface Tool {
    // Name of the tool
    name: string;
    
    // Description of what the tool does
    description: string;
    
    // Execute an action with parameters
    execute(action: string, parameters: object): Promise<any>;
    
    // Get tool capabilities
    getCapabilities(): {
        name: string;
        description: string;
        actions: Array<{
            name: string;
            description: string;
            parameters: Array<{
                name: string;
                description: string;
                type: 'string' | 'number' | 'boolean' | 'object' | 'array';
                required: boolean;
            }>;
        }>;
    };
}
```

### Creating a New Tool

1. Create a new file in `src/tools/` for your tool
2. Implement the Tool interface
3. Export a singleton instance
4. The tool will be automatically loaded by the tool manager

Example:
```javascript
class MyTool {
    constructor() {
        this.name = 'myTool';
        this.description = 'Does something useful';
    }

    async execute(action, parameters) {
        switch (action) {
            case 'doSomething':
                return this.doSomething(parameters);
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'doSomething',
                    description: 'Does something useful',
                    parameters: [
                        {
                            name: 'input',
                            description: 'Input to process',
                            type: 'string',
                            required: true
                        }
                    ]
                }
            ]
        };
    }
}

module.exports = new MyTool();
```

## Contributing
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License
MIT

### Logging and Progress Updates

The system provides two types of logging:

1. **Debug Logging**
   ```javascript
   const logger = require('./logger');
   
   // Log debug information
   logger.debug('context', 'message', { data: 'object' });
   
   // Log object directly
   logger.debug('context', { someData: 'value' });
   ```
   Debug logs appear in:
   - Console output
   - Debug panel in UI
   - Include timestamp and context

2. **Response Messages**
   ```javascript
   const logger = require('./logger');
   
   // Plain text response
   logger.response('Simple message');
   
   // Markdown formatted response
   logger.markdown(`
   # Task Complete
   - File created: \`example.js\`
   - Status: 
   
   ## Next Steps
   1. Run the tests
   2. Check the output
   `);
   
   // Code block with syntax highlighting
   logger.code(`
   const result = await api.process(data);
   console.log(result);
   `, 'javascript');
   
   // Response with metadata
   logger.response('Message', {
     format: 'markdown',
     metadata: { timestamp: new Date() }
   });
   ```
   Response messages:
   - Appear in main chat window
   - Support multiple formats:
     - Plain text (default)
     - Markdown with full formatting
     - Code blocks with syntax highlighting
   - Can include metadata for tracking
   - Support tables, lists, code blocks in markdown
   - Automatically highlight code syntax

This dual logging system ensures:
- Developers can debug with detailed information
- Users get clear, formatted feedback
- Complex data is presented in a readable way
- Code examples are properly highlighted

### Updates to Event Handling

- Implemented a message queue to manage sending messages from `assistantResponse` and `debugResponse` events in order.
- Created a `processQueue` function to ensure messages are sent sequentially, preventing race conditions in event handling.

## UI Components

The interface includes several key components:

1. **Chat Container**: Main area for displaying conversation history
2. **Output Container**: Displays temporary status updates and working messages
   - Shows agent's current status and processing updates
   - Messages auto-hide after 5 seconds
   - Will be used for displaying code output and results in future iterations
3. **Input Container**: Area for user input and controls

## Running the Application

### Development Mode

```bash
npm run dev
```

This starts the application in development mode with nodemon watching for file changes.

### CLI Query Mode

You can run a single query directly from the command line:

```bash
npm run query "your message here"
```

This processes a single message and returns the response without starting the web server. Useful for quick testing or scripting.

### Production Mode

```bash
npm start
```

Starts the application in production mode.

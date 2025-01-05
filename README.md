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
- Provides specific capabilities (file operations, etc.)
- Each tool has a defined interface with name, description, and parameters
- Tools are loaded dynamically from the tools directory
- Tools should be forgiving with parameter formatting:
  - Handle both stringified and object parameters
  - Provide clear error messages for invalid parameters
  - Use sensible defaults where possible
  - Don't assume perfect parameter formatting from the executor

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
         "type": "conversation|task|progress|error"
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

2. **Progress Updates**
   ```javascript
   const logger = require('./logger');
   
   // Send progress message to chat window
   logger.response('Working on your request...');
   ```
   Progress updates:
   - Appear in main chat window
   - Provide real-time status
   - Show step-by-step progress
   - Keep user informed of:
     - Task start
     - Plan creation
     - Execution progress
     - Evaluation status
     - Retry attempts

This dual logging system ensures:
- Developers can debug with detailed information
- Users get clear, real-time progress updates
- System state is transparent at all times
# LLM Agent

An AI agent powered by GPT-4o-mini that can engage in natural conversation and execute tasks using tools.

## Architecture

The system consists of three main components:

### 1. Ego Layer
- Handles natural language conversation
- Determines when a message requires tools vs. simple conversation
- Maintains agent identity and capabilities
- Uses GPT-4o-mini for natural language understanding

### 2. Coordinator Layer
- Receives tasks from the ego layer when tools are needed
- Plans task execution using the planner
- Executes plans using available tools
- Returns results back to the ego layer
- Provides detailed error handling with:
  - Full stack traces
  - Step-by-step execution status
  - Contextual error information
  - Tool-specific error details

### 3. Tool Layer
- Provides specific capabilities (file operations, etc.)
- Each tool has a defined interface with name, description, and parameters
- Tools are loaded dynamically from the tools directory

## API Endpoints

- `POST /chat`: Send messages to the agent
  - Request body: `{ "message": "your message" }`
  - Response: Agent's response with conversation or task results

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

2. Set up your environment variables:
```bash
cp .env.example .env
# Edit .env and add your OpenAI API key
```

3. Start the development server:
```bash
docker-compose up --build
```

### Development Scripts

#### Restart Container and Run Tests

We have a helper script to restart the container and run tests:

```bash
# Make the script executable
chmod +x scripts/restart.sh

# Run the restart script
./scripts/restart.sh
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

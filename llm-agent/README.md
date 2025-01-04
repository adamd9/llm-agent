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
  - `parameters`: Expected parameters
  - `execute()`: Function to run the tool

### Session Management
- Each chat session has a unique ID
- Session history is maintained for context
- History can be retrieved via API

## Contributing
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License
MIT

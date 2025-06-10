# LLM Agent

An AI agent that chats and executes tasks using OpenAI models and a flexible tool system.

## Features

- Natural language conversation with a configurable personality
- Planner and coordinator for tool-based task execution
- Session based logging and conversation history
- WebSocket API for real-time interaction

## Getting Started

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

The first run generates `data/settings.json` which can be edited to adjust defaults.

## Configuration

Set `LLM_AGENT_DATA_DIR` to choose where the `data` directory lives. See `data/settings.json` for other runtime options after the first start.

## Development

- Hot reloading with `npm run dev`
- Logs stored under `data/logs`
- Run tests with `npm test`

## Documentation

- [Architecture](docs/architecture.md) – message flow and subsystem details
- [API](docs/api.md) – WebSocket messages and endpoints
- [Testing](docs/testing.md) – running Jest and Puppeteer tests
- [MCP Guides](docs/mcp/) – Model Context Protocol tool system

## License

MIT

# LLM Agent

An AI agent that chats and executes tasks using OpenAI models and a flexible tool system.

## Features

- Natural language conversation with a configurable personality
- Planner and coordinator for tool-based task execution
- Session based logging and conversation history
- WebSocket API for real-time interaction
- Multiline chat input for longer messages
- Text-to-Speech (TTS) for assistant responses (with smart playback)
- Sleep mode for manual session cleanup (consolidates memory and trims history)

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

Default configuration is loaded from `config/defaultSettings.json`. The first run
generates `data/settings.json` which stores any runtime/user overrides.

## Configuration

Set `LLM_AGENT_DATA_DIR` to choose where the `data` directory lives. See
`data/settings.json` for runtime options saved after the first start. A
web-based settings page is available at `/settings` with tabs for general
options, prompt overrides and runtime statistics.

### Prompt Caching

The system includes a prompt caching mechanism to improve performance and reduce API calls:

- **Cache Location**: `data/prompt-cache/`
- **Cache Logs**: `data/prompt-cache-usage.log`
- **Cache TTL**: 24 hours (automatic cleanup of older entries)

#### Cache Management

- Cache entries include metadata about the original query and parameters
- Cache keys are generated based on message content and model parameters
- The system automatically cleans up cache files older than 24 hours on startup

#### Environment Variables

- `ENABLE_PROMPT_CACHE` - Set to `true` to enable the prompt cache (default: `true`)
- `DISABLE_PROMPT_CACHE` - Set to `true` to disable the prompt cache
- `CACHE_TTL_MS` - Override the default 24-hour TTL (in milliseconds)

#### Cache Inspection

You can inspect the cache contents programmatically:

```javascript
const promptCache = require('./src/utils/promptCache');

// List all cache entries
const entries = promptCache.listCacheEntries();
console.log(entries);

// Inspect a specific cache entry
const entry = promptCache.inspectCache('cache-key-here');
console.log(entry);

// Clean up old cache files manually
const { deleted, errors } = await promptCache.cleanupOldCacheFiles();
console.log(`Deleted ${deleted} old cache files, ${errors} errors`);
```

## Development

- Hot reloading with `npm run dev`
- Logs stored under `data/logs`
- Run tests with `npm test`
- Cache debug logs are available in the main application logs with the `promptCache` prefix
- A scheduler tool allows tasks to be queued for periodic execution, viewed, or removed. Tasks are stored under `data/scheduler/tasks.json` and run as regular user messages.

## Documentation

- [Architecture](docs/architecture.md) – message flow and subsystem details
- [API](docs/api.md) – WebSocket messages and endpoints
- [Testing](docs/testing.md) – running Jest and Puppeteer tests
- [MCP Guides](docs/mcp/) – Model Context Protocol tool system

## License

MIT
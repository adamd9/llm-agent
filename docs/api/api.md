# API Guide

The agent communicates with clients over a WebSocket connection.

## WebSocket Connection

Connect to `ws://<host>` and you'll receive a session message:
```json
{
  "type": "session",
  "sessionId": "unique-session-id"
}
```

## Message Types

### Client to Server
Send messages like:
```json
{
  "message": "your message",
  "sessionId": "your-session-id"
}
```

### Server to Client

**Session Message**
```json
{
  "type": "session",
  "sessionId": "unique-session-id"
}
```

**Response Message**
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

**Working Status Message**
```json
{
  "type": "working",
  "data": {
    "status": "current status message"
  }
}
```

**Debug Message**
```json
{
  "type": "debug",
  "data": {
    "context": "debug context",
    "message": "debug message",
    "data": {},
    "timestamp": "ISO timestamp"
  }
}
```

**Error Message**
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
`GET /chat/:sessionId/history` returns the chat history for a session.
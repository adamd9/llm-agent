# Release Notes

## Event-Based Scheduler and Sleep Tool

This release introduces an upgraded scheduler system and a new **sleep** tool.
Scheduled tasks can now be triggered either at fixed intervals or in response to
session events such as `startup`, `idleTimeout`, and `conversationEnd`.

The sleep tool performs session cleanup and can be invoked manually or by the
scheduler. Cleanup consolidates memory, trims history and emits a `sleep` event
to all connected clients.

### Using the Scheduler Tool

Add a periodic message task:
```bash
agent scheduler addTask '{"message": "ping", "frequencySec": 3600}'
```

Trigger a tool when the session becomes idle:
```bash
agent scheduler addEventToolTask '{"eventName": "idleTimeout", "toolName": "sleep", "action": "sleep", "parameters": []}'
```

### Testing

1. Start the agent with `npm start`.
2. Add a scheduler event as above and observe that the tool runs when the event
   fires (e.g., wait for the idle timeout).
3. Watch for `sleepResult` and `sleep` messages in the client to confirm the
   cleanup occurred.

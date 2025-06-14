Review of Proposed Session Management Architecture
Conceptual Overview and Goals
The new architecture aims to treat the running agent server as a single persistent entity (an AI "assistant") accessible via multiple channels (chat UI, email, messaging, etc.). All clients share one conversation state and memory, rather than having isolated sessions per connection. This fulfills the vision of deploying a persistent “receptionist/executive assistant” in the cloud that anyone can interact with through various interfaces. The design will move session control to the server so that: (1) Conversations persist beyond client disconnects; (2) Background tasks continue even if the UI closes; (3) Multiple clients can connect and observe or participate in the same ongoing conversation. Below we review the current design proposal and suggest refinements to better achieve these goals.
Single Session Manager and Multi-Channel Coordination
Under the proposal, the server will host one long-lived SessionManager responsible for all session state and client coordination
GitHub
GitHub
. This is a shift from the current implementation where each WebSocket connection gets a fresh session with its own history and memory context. In the existing code, for example, the server generates a new sessionId for every connection and resets memory on each new WebSocket
GitHub
GitHub
. This results in separate agent states for each client, and the browser had to manage conversation history. The new SessionManager will instead maintain one global session (with a single session ID) that all clients join. Refinement – Shared State Structure: The SessionManager should hold in one place all the information that was previously tied to a single WebSocket: the active conversation log, agent memory handles, and the list of connected clients. Rather than a Map of sessionId -> history as in the current code
GitHub
, we can maintain a single shared history log and a list (or set) of active client connections. Each connecting client would be added to this list, and on disconnect it would be removed, but the session state remains in memory as long as the server runs (or until an idle timeout, discussed later). Any client that reconnects (or a new client that attaches) would be pointed to the same global session. This ensures continuity. Refinement – Session Identification: Even with a single session, using a session ID string is still useful – for instance to reference the history via an API or for logging. We could use a fixed ID (like a UUID generated at server start or a constant) for the global session. Alternatively, the first client to connect can trigger creation of a session with an ID that subsequent clients reuse (the server could provide this ID to clients for reconnection). Since no authentication is required for now, the simplest approach is to treat every connection as part of the one session automatically. The server can still send a “connected” event containing the session ID, but it will be the same ID for all clients, indicating they are in the shared session (as opposed to each getting a unique ID as happens now
GitHub
). Maintaining Existing Features: This single-session model inherently means dropping the notion of multiple independent sessions running concurrently. In the current implementation, it was technically possible (though not well-supported) to open separate browser sessions and have separate agent contexts. With the new design, all clients share context, so separate conversations would interfere. This is an intentional change aligning with the “single assistant entity” concept. If the use-case of parallel, independent conversations is needed in the future, it would require extending the SessionManager to handle multiple sessions (likely with user authentication or explicit session selection). For now, we accept this trade-off in favor of simplicity. All other agent capabilities (tool use, planning, memory, etc.) remain available – we are only changing how session state is managed and shared, not removing any core functionality.
Connection Handling and Reconnection Logic
In the new architecture, any client (web UI, CLI, etc.) that connects via WebSocket will join the shared session automatically
GitHub
. The server’s SessionManager will add the WebSocket to its internal connection list and immediately send down the current session state. In the current code, when a WebSocket connects the server was creating a brand new session and returning a payload {type: "connected", sessionId, isNewSession}
GitHub
. Going forward, the server should indicate something like {type: "connected", sessionId: "<shared-id>", resumed: true} to signify the client has attached to the ongoing session. Replaying History on Connect: Upon a new connection, the SessionManager needs to provide some or all of the past conversation and events so the client can catch up
GitHub
. There are a couple of options to refine this:
Full History vs. Partial: If the conversation history (including system events) is not too large, the simplest approach is to transmit the entire logged history to the client on connect. This guarantees the client’s UI can render exactly what has happened so far. The downside is if the history is very long (e.g. many debug messages or a multi-hour session) this could be a heavy payload and slow to render. A refined approach is to send the most recent N messages or events (for example, the last 50 entries) or to segment history by conversation sessions (if we implement periodic resets). Initially, we can err on the side of completeness and send the full history; as we gather usage data, we can introduce limits if needed. This answers Outstanding Question 2: a reasonable approach is replay the full log on reconnect for now, while perhaps making it configurable or limiting extremely long histories. Later, we might implement a rolling window (e.g. last N events) if performance becomes a concern.
History Content: We should clarify which types of events to replay. The agent produces not only user and assistant messages, but also status updates, debug logs, and subsystem messages (tool outputs, etc.). For a consistent user experience, the client should probably receive all events that it would have originally received in real time. That means the SessionManager needs to buffer those events. In the current code, the browser stored conversation locally, so the server didn’t need to send past user messages at all. In the new design, however, the server is the source of truth for history. User messages should be part of the session history (currently they are not recorded in the sessions array – only assistant responses and debug messages are
GitHub
GitHub
). We will need to adjust this: when a user message comes in from any channel, the SessionManager should log it (e.g. push {role: "user", content: "..."} to history) and broadcast it to all clients. Logging user prompts ensures that when another client connects later, they can see the full dialogue (who asked what, and how the assistant replied). The history replay on reconnect will include these user entries, assistant replies, and possibly important system messages (like “Assistant is working on X”). We might choose to exclude very low-level debug info from automatic replay to keep the UI cleaner, or provide a toggle for the user to view detailed logs. For now, including everything in the history ensures fidelity – the UI can decide how to present it.
Multi-Client Synchronization: With multiple WebSocket clients attached, all should receive the same stream of events in real time so their views remain in sync. The design suggests broadcasting outputs to every connected client
GitHub
. We should implement this by having a single event handler for agent events in the SessionManager (instead of one per WebSocket as in the current code). In the current implementation, each connection registers its own listener on the shared event emitter and pushes responses to its own queue
GitHub
GitHub
. This could lead to inconsistent state if multiple sessions were active. The SessionManager can improve this by listening to agent events once and then iterating over all connected WebSockets to forward the event. This way, all clients get every update. For example, if an email triggers a new question to the agent, and the agent starts working, a connected chat UI should see the incoming question (from the email channel, perhaps labeled accordingly) and the subsequent assistant answer. Conversely, if a user on the Web UI asks something, a future UI client or CLI attaching to the session should see that query and answer in the log. Essentially, the SessionManager plays the role of a hub, routing messages and events to all endpoints. One thing to clarify: if two or more clients are connected simultaneously, are they all representing the same human user (e.g. you on your laptop and phone at once), or could they be different people sharing one agent? For now we assume it’s one user on multiple devices, or at least a trusted group with a common goal (since there’s no auth or separate personas). This means we don’t need to label which client said what – it’s all “User”. If needed, in the future we might attach a source identifier to user messages (e.g. “User (via email)”) so that it’s clear in the log where the input came from. Initially, though, a single user identity is fine, simplifying design.
Message Flow, Concurrency, and Cancellation
The message flow in the design remains one-at-a-time processing

## Idle Timeout and Persistence Design

### 30-Minute Session Timeout
After 30 minutes of user inactivity, the server implements a smart pruning strategy:
- Cleans transient data (debug logs, tool traces)
- Preserves essential chat context for continuity
- Enables reference to recent dialogue in subsequent messages

### Chat Ring Implementation
- Maintains a deque of last 20 user↔assistant exchanges (chat_ring)
- Stored in memory for quick access
- All other history_buffer content is cleared on idle timeout

### Persistent Chat Storage
- All user & assistant messages stream to `data/chat_history.ndjson`
- File rotation occurs at 5 MB threshold (size-based rotation)
- Ensures crash-safe transcript preservation
- Enables powerful search capabilities

### Idle Timeout Sequence
1. Flushes complete history_buffer to timestamped audit log
2. Trims in-memory state to chat_ring (20 exchanges)
3. Executes memory.consolidateShortTermToLongTerm() to preserve insights
4. Broadcasts reset event to all clients:
   ```json
   {
     "type": "reset",
     "reason": "idle-timeout",
     "kept": 20
   }
   ```

### History Tool Interface
Provides agent-callable methods:
- `history_get_recent(n=20)`
- `history_get_range()`
- `history_search()`

Enables model to restore context from past content when short-term memory is insufficient.

### Configuration Defaults
```yaml
session:
  idle_timeout_sec: 1800      # 30 min
  retain_exchanges: 20        # chat_ring size
  chat_log_path: data/chat_history.ndjson
  log_rotate_mb: 5            # rotate at 5 MB
```

### Implementation Tasks
1. Build IdleTimeoutService and integrate with SessionManager
2. Implement ChatLogWriter with size rotation
3. Register History Tool and update system prompt
4. Frontend updates:
   - Handle reset events
   - Display notice when context is trimmed to 20 exchanges

GitHub
, which aligns with how a human assistant would operate. We should enforce a single active request in the SessionManager to avoid overloading the agent’s reasoning process (the agent is not designed for parallel independent conversations). Several refinements are needed to handle concurrency and cancellation gracefully:
Locking and Queueing: Currently, if a WebSocket message arrives it is immediately passed to ego.processMessage, and the code did not explicitly prevent a second message from being processed concurrently. In the new architecture, the SessionManager should implement a simple lock or busy flag. When a request starts, the session goes into a “busy” state. If any client submits another message during this time, the server should reply with a notice that the assistant is busy (perhaps a message of type “error” or “status” indicating the user must wait)
GitHub
. The design doc suggests the server respond that the session is busy and let the client decide to wait or cancel
GitHub
. We could also implement an optional queue: for example, allow one message to be queued and automatically processed once the current task finishes. However, an automated queue might be confusing if multiple inputs stack up – it might be safer initially to reject or inform the user of the busy status, forcing them to explicitly retry or cancel. A compromise could be to buffer the latest message and override any earlier pending ones if a user sends multiple quick updates (some chat systems do this for rapid user corrections). But for now, keeping it simple – one at a time, no automatic queue – is acceptable. We just need to communicate the busy status clearly to the user.
Cancellation Mechanism: To address Outstanding Question 6, we should design how a user can interrupt a long-running request. The SessionManager can expose a method like cancelCurrentTask(). Clients (UI or others) could send a special cancel command (for instance, a message {type: "command", action: "cancel"} or a specific WebSocket message) when the session is busy. On receiving this, the SessionManager would attempt to halt the agent’s processing. Implementing actual cancellation within the agent’s workflow can be tricky – we need to propagate the cancel signal to the ego processing pipeline. One straightforward way to start is to set a flag in SessionManager (e.g. sessionManager.cancelRequested = true) and ensure that long operations check this flag periodically. The agent’s architecture has multiple steps (planning, tool execution, etc.), so between steps we could insert checks. For example, after each tool execution or each LLM call, check if a cancel was signaled and if so, abort the remaining plan. We might also leverage the underlying OpenAI API client if it supports an abort controller or cancellation token (not sure if our openaiClient.chat method supports that, but we can investigate). As an initial implementation, even a coarse cancellation is useful: the SessionManager could simply ignore/discard any further output from the agent once canceled (essentially not forward it to clients), and reset the agent state for a new query. This isn’t ideal (it wastes computation), but it achieves the UX effect of “stop processing and move on.” A more refined approach is to genuinely halt the process: for example, by throwing an exception that bubbles up and is caught, or by using a child process for the agent that can be killed. Given our agent runs in-process with many asynchronous calls, carefully injecting cancellation points is the likely approach.
Broadcasting Cancel Events: When a cancellation happens, all clients should be informed. We can emit a special event to all WebSockets like {type: "info", data: {"status": "Request canceled by user"}} or a dedicated cancelled message type. The UIs can use this to stop any loading indicators and know that the current task was aborted. The SessionManager would then clear the busy flag and be ready to accept the next input (perhaps from the client who requested cancel or any other). In summary, cancellation will be surfaced as a user-initiated event broadcast to everyone, so the conversation log might include a system message like “(The current request was canceled.)”. This ensures shared awareness across channels.
User Message Ordering: Because only one request runs at once, if two clients send messages nearly simultaneously, one will get the busy response. If the user really intended both queries, they’d have to send the second again after the first completes (or send a cancel then retry the second). This sequential model might feel limiting but maintains clarity – the assistant won’t be trying to answer two things at once. We should document this behavior for users (e.g. “The assistant can only handle one question at a time”). Later, we could consider more advanced concurrency (like handling a quick interrupt command even while a task is running), but that requires deeper changes.
Preserving System Events: All agent sub-events (like tool execution updates, intermediate “working on X” messages, etc.) will continue to flow to clients in real time. The SessionManager simply needs to route them to all connections. In the current system these events are emitted globally and each WebSocket pushes them to its own queue
GitHub
GitHub
. With a single session, we consolidate that: for example, when the agent emits a systemStatusMessage with status text, the SessionManager sends that same {type: "working", data: {...}} payload to each connected WebSocket. This way, if you have the web UI open on two devices, both show the “Assistant is working…” message and any tool output as it streams.
Persistence and Session Timeout Policy
The design proposes keeping session state in memory initially, with optional periodic disk writes for recovery
GitHub
. It also introduces a session timeout (default 30 minutes) after which short-term memory is consolidated into long-term and the conversation history is cleared for a fresh start
GitHub
. Here are some considerations and refinements for this aspect:
In-Memory vs Durable Storage: For Outstanding Question 3, we likely do not need full persistence across server restarts in the first iteration. Using in-memory storage for the session is acceptable initially, because deploying this “assistant” is likely done in stable environments and losing state on a restart is not critical (especially if long-term memory is saved separately). We should, however, ensure that crucial data (like the knowledge base in long-term memory) is written to disk. The current memory module already writes long-term memory to a file (data/memory/long/long_term.txt) and short-term to short_term.txt
GitHub
GitHub
. So, even if the server restarts, the long-term accumulated knowledge persists. The short-term conversation context would be lost on a crash or restart unless we implement a quick save. We might decide that’s okay (the conversation is transient), or we could do a lightweight serialization of the session history to disk every so often. Given simplicity is a priority, I would lean toward not persisting the live session on disk for now. We can document that if the server restarts, the current conversation is interrupted and will start anew (the assistant itself doesn’t forget learned info because long-term memory is on disk and loaded at init). If we want minimal persistence, one idea is to reuse the logger output – since we log all interactions to a file per session, that file could serve as a recovery log if needed. But again, this can be future work; the immediate design can go with in-memory session state.
Session Timeout Behavior: Clearing the conversation after 30 minutes ensures the short-term context doesn’t grow indefinitely and cause performance issues. We should clarify whether this 30-minute timer is based on inactivity or total session lifetime. A sensible approach is to treat it as an idle timeout: e.g. 30 minutes of no user messages triggers consolidation. If the user is actively chatting for longer than 30 minutes, we might either (a) not cut them off mid-conversation, or (b) perform a rolling consolidation of older messages. Option (a) is user-friendly: as long as you keep interacting, the session stays “live.” Once you stop for 30 minutes, the next message will start a fresh context (after doing the consolidation). The doc’s wording
GitHub
 suggests a fixed duration, but we should likely make it resettable – i.e. each user interaction could refresh a last-active timestamp. We should expose this timeout as a config option, as noted, and allow turning it off (for a never-ending session) or adjusting it to needs.
Consolidation Mechanics: When the timeout hits, what exactly happens? The short-term memory (which includes recent conversation and tool results stored in short_term.txt) should be processed into long-term memory. Thanks to the agent’s design, some consolidation is already happening incrementally: after each user query, the Ego.handleBubble triggers a reflection that stores insights into long-term memory
GitHub
. That means key information from the conversation is likely already saved as we go. However, we might still want to archive the conversation transcript or any details not captured by reflection. A straightforward method is: read the short_term.txt file (or use the in-memory history log) at timeout, and append a summary or the raw contents to long_term.txt for record-keeping. We could leverage the existing memory consolidation LLM prompt to summarize the conversation. The Memory.consolidateLongTerm() function already uses an LLM to merge and prune long-term memory entries
GitHub
GitHub
. We might create a similar consolidateShortTermToLongTerm() that takes the recent conversation (maybe just the high-level user and assistant messages, not every debug log) and generates a condensed memory entry to store. This ensures the essence of the session is retained without cluttering long-term memory with every minor step. On the first implementation, if we want to avoid complexity, we can simply move the short-term log to a dated long-term file or entry (perhaps under a <MEMORY> tag labeled “conversation transcript [timestamp]”). Even dumping it verbatim into long-term memory (and perhaps later running the long-term consolidation to clean it up) would work. The key point is to not lose important context. Since the agent’s reflection mechanism is quite comprehensive (it stores lessons learned, etc.), transferring the raw history might not be strictly necessary for functionality, but it could be valuable for audit or re-reading past conversation if needed.
Clearing History and Resetting Session: After consolidation, we will clear the in-memory conversation log and short-term memory storage, effectively resetting the context as if starting with a fresh brain. Clients that remain connected should be informed that the session was reset or simply see that no prior messages remain. We should send a special event or include in the next “connected” event that the context was cleared due to timeout. If a user sends a message after a timeout, and they still had the UI open showing old messages, the assistant may not recall those messages (since we wiped short-term memory). This is expected; the user should either remember the conversation or reintroduce context if needed. We might consider proactively notifying the user: e.g. “(System: conversation context was reset after inactivity.)”. This would answer the user’s possible confusion if the assistant seems to forget something after a long pause.
Manual Reset: In addition to automatic time-based reset, consider offering a manual conversation reset (a “Clear Conversation” command/button). Currently, users achieved a fresh session by simply refreshing the browser (which created a new session and called resetMemory()
GitHub
). In the new model, a refresh will not start a new session; it will rejoin the existing one. So we should provide a way for the user to intentionally start over. This could tie into the same logic as consolidation: e.g. a user command that triggers immediate consolidation and clears the history. Implementing this is straightforward with SessionManager – essentially call core.memory.resetMemory() (to clear short-term file and any in-memory context) and wipe the history list. We may or may not also reset the session ID or log file – probably not necessary, we can continue using the same session ID for simplicity. The clients should be instructed to clear their displayed messages when this happens (maybe via a special event type like reset).
Integrating Additional Input Channels (Email, Messaging, etc.)
A major goal is to allow channels beyond the WebSocket UI to feed into the SessionManager. We want emails, WhatsApp messages, SMS, or other inputs to be treated as if the user “said” something to the assistant. Outstanding Question 4 asks about the best interface for this. Key suggestions:
Unified Input Method: The SessionManager can expose a function or endpoint like SessionManager.handleExternalMessage(source, content). This would wrap the incoming content in a standard format and feed it into the same processing pipeline as a chat message. For example, if a new email arrives for the agent to handle, some part of the system will call handleExternalMessage("email", emailText) (and possibly include metadata like sender or subject). The SessionManager would then broadcast to all connected clients something like: {type: "user", data: {channel: "email", content: "<emailText>"}} to indicate the assistant received an email query. It then proceeds to process it exactly like a normal user question (calling ego.processMessage etc.). From the assistant’s perspective, there’s no difference – it’s just another user prompt. This abstraction keeps channel-specific logic outside of the core agent; the channels are just feeders.
Email Polling or Hooks: To actually fetch emails, we’ll likely implement a background task or separate module that monitors an inbox. A simple approach is periodic polling via IMAP (e.g. check an email account every X seconds for new messages). When it finds a new email addressed to the assistant, it calls the above handleExternalMessage. This can run on an interval using something like Node’s setInterval or a cron job within the server. Since we’re focusing on architecture, we won’t dive deep into the IMAP integration here, but we should design the interface expecting asynchronous external triggers. Similarly, if integrating with WhatsApp or Slack, those typically use webhooks or APIs that could call into our server. We might create a small REST API endpoint for external messages (e.g. an /api/external-message that accepts {source: "whatsapp", message: "..."} and then internally calls SessionManager.handleExternalMessage). Security/auth for that endpoint would be needed in a real deployment, but for now, it could be open or key-protected.
Output via Channels: The design mainly discusses input channels, but for completeness, consider how the assistant might respond back through that channel. For chat UI, the response is shown on screen. For email, presumably the assistant should send an email reply. That requires the system not only ingest an email but also know where to send the answer. We might need to capture the sender’s address and original email context when an email arrives. The SessionManager could then either automatically draft a response and use an SMTP client to send it, or it could require user confirmation. This is an edge-case decision: if the assistant is fully autonomous, it might answer the email on its own. If it’s more of a user’s helper, it might produce a suggested reply and the user (on a UI) can approve it. This goes beyond session management, but it’s worth noting that our architecture should support bi-directional channel integration (especially for messaging apps and email). Perhaps initially, we’ll have the assistant’s reply to an email appear in the conversation, and then a simple mechanism to forward that text as an actual email to the intended recipient. Implementation can be deferred, but it’s good to keep in mind.
Channel-Specific Formatting: When broadcasting an external message to connected clients, we might include the channel info so the UI can, for example, label it or style it (e.g. show an email icon next to messages that came via email). The session history could record this too (we might augment the stored message object with {role: "user", content: "...", channel: "email"}). This is not strictly necessary, but aligns with making the assistant feel truly multi-modal.
User Presence and Notifications (Outstanding Question 7): The SessionManager should keep track of which real-time channels (WebSocket UIs, possibly a CLI session) are currently active so it knows where to send spontaneous alerts. For example, suppose the agent receives an email while you happen to have the web UI open; you’d want to be notified immediately in the UI that something came in. Conversely, if no UI is open at that moment, maybe the assistant still processes the email and sends a reply (since it can operate autonomously), but you as the user might otherwise miss that it happened until you check logs. A simple approach to presence is: if at least one WebSocket client is connected, consider the user “online” in real-time. If none are connected, the user is “away” (only asynchronous channels available). The SessionManager already naturally knows how many clients are connected. We could enhance it by tracking a “last active client time” or whether a particular client indicated the user is looking (some systems send a ping or have the user mark themselves away). That may be overkill now. Initially, just assume if a WS connection is open, the user can see events. Using that, for incoming asynchronous events (like a new email), the SessionManager can decide how to alert: if one or more UI clients are connected, it broadcasts the event there (as described). If none are connected (user completely offline from UI), we might either do nothing special or possibly use an out-of-band notification. One idea: if the user has a mobile app or some push mechanism, we could send a push notification. But that’s beyond our current scope. More realistically, the assistant could even send an email notification to the user saying “I received an email from X and have replied.” However, since the user’s email might be the one that triggered it in the first place, that’s not needed. For now, the safe refinement: broadcast all events to all connected WebSockets (which is effectively what we’ll implement). If none are connected, the events still get logged in the session history, and any new client that connects later will see them in the backlog. So you won’t miss anything; you just might see it later. This satisfies notification in a basic way. In the future, we can improve presence detection and possibly target notifications to the last active channel. For instance, if the user was last seen on WhatsApp and not in the web UI, maybe the assistant should send a WhatsApp message to notify them of an incoming email. These are advanced multi-channel coordination concerns that we can tackle once the basics are in place.
Allowing Console/Terminal Interaction
A neat feature in the proposal is the ability to send queries via the server’s own terminal (where the Node process is running)
GitHub
. Currently, the code supports a one-shot CLI query by taking a command-line argument when launching (npm run query "question"), processing it, then exiting
GitHub
GitHub
. For a persistent server, we want a REPL-like ability: the operator can type into the running process and have it treated as user input to the assistant, with responses printed to the console. This can be very useful for debugging or operating the assistant over SSH. Implementing Terminal Input: We can use Node’s standard input to achieve this. One approach is using the built-in readline module. When the server starts (after finishing initialization and starting the WebSocket server), we instantiate a readline interface on process.stdin. We can then listen for line events – each line the operator types is a query to send to the SessionManager (just like a WebSocket message). For example:
const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (input) => {
    sessionManager.handleConsoleInput(input);
});
The handleConsoleInput would simply funnel the input into the same processMessage flow and perhaps tag it as coming from "console". In effect, it’s similar to an external channel. The difference is in how we output the assistant’s reply to the console. Since the console isn’t a WebSocket, the SessionManager can directly write to stdout any responses or events that come from the agent. We likely should leverage the existing logging or event system: for instance, whenever we broadcast an assistant response to websockets, also console.log() it for the operator to see. We might format it a bit (maybe strip out JSON and just show the text content). One challenge is that our console input should not interfere with the server’s own logs that are written to stdout. The current logger prints debug info to the console (and to files). We’ll have to differentiate operator interactions from system logs so it’s readable. We could possibly turn down the console log verbosity when using interactive mode, or simply clearly prefix operator input and assistant output. For example:
>> (operator types) How's the weather tomorrow?
Assistant: I can check that for you... (etc)
We may incorporate basic color coding or prompts (>> for user input). These are implementation details, but the main idea is that hooking into process.stdin after server start is feasible and won’t block the event loop (Node’s readline works asynchronously). We just need to ensure stdin is not in raw mode (so it reads line by line, not character by character, unless we want a fancy realtime input). A line-by-line approach is fine for now. After implementing this, we can answer Outstanding Question 5: The best mechanism is to use Node’s readline interface on STDIN to accept input from the terminal running the server, and have those inputs routed into the SessionManager as if from a user. The outputs can be written to STDOUT. This essentially gives a basic text-mode UI running concurrently with the web UI. It should be optional – if the server is run in a context where no one is watching the terminal (like a cloud server), it doesn’t harm anything (you just wouldn’t be typing into it). If we detect no TTY, we might skip setting up readline.
Client UI Adjustments
Since we are moving session management to the backend, the frontend (browser client) will require some changes in how it handles state:
No Local History: The client should no longer keep the definitive message history or assume a new conversation on page refresh. Instead, upon connecting, it will receive a connected event with an ID and likely a batch of history events to render. We should update the client code to, on receiving a connected message with resumed: true, fetch or use the attached history to populate the chat window. The current API already has an endpoint to get history (GET /chat/:sessionId/history
GitHub
), which we can continue to use if needed. We might simplify things by including a portion of history directly in the welcome/connected message to avoid an extra round trip. Either approach is fine.
Displaying Concurrent Interactions: If multiple devices or channels are sending messages, the UI might receive a user message that the user themselves didn’t type in that device. For example, you have the web UI open and you send an email from your phone to the assistant’s address – the web UI would get a “user said: <email content>” event via the SessionManager. The UI should treat it as just another user turn in the conversation (perhaps with a label if we include one). The client might need small updates to handle a type: "user" event coming from the server (currently the server wasn’t sending user messages back, since the client itself added what the user typed). We will add this server echo of user inputs so that all clients stay in sync. The frontend should avoid double-printing the user message (perhaps it should only print it when received from the server, not immediately on submit). In practice, we can have the UI optimistically show the user’s query but tag it such that if a duplicate comes from the server it’s ignored or used to confirm.
Busy/Cancel UI: When the server responds with a “session busy” state, the UI should inform the user that their input was not processed because another request is running. We might define a message type for this, e.g. {type: "status", data: {message: "Assistant is busy with another request"}}. The front-end could display that as a small note or toast. If a cancel event is broadcast, the UI should re-enable input fields and perhaps show that the previous response was canceled. We might want to add a "Cancel" button in the UI when a query is in progress, which sends the cancel command to the server. These are usability enhancements that pair with our SessionManager’s concurrency control.
Session Reset Awareness: If the session times out and resets, or if the user manually resets it, the front-end should clear the chat view. This can be done by listening for a special reset event or by noticing that a new sessionId was issued (if we choose to generate a new one upon reset). Using the same session ID even after reset is simpler for back-end logic, but it means the front-end might not automatically know the conversation was wiped. We might therefore emit an explicit event like {type: "reset", reason: "timeout"} so the UI can, for instance, start a new conversation thread display. We will coordinate this as we implement the timeout feature.
In summary, the client will become dumber in terms of state – it will rely on the server to tell it the current conversation state, and it will simply render what it’s told. This is generally a good thing (single source of truth). It will, however, need updates to handle new message types (user messages echoed back, busy statuses, etc.). Ensuring a smooth UX across these changes will be important.
Resolving Outstanding Questions
Finally, let’s explicitly address the questions posed in the design doc with the conclusions from the above discussion:
Global Session vs Multi-Session: This was already resolved – we proceed with a single global session and no auth for now. We’ve noted the implications (all users share one agent context).
History to Reconnecting Clients: We will replay the full conversation history (all significant events) to clients that reconnect, at least in the initial version
GitHub
. This guarantees no information is missing. We’ll monitor performance; if needed, we can limit to the last N events or have the client request older history on demand. The approach may involve directly pushing the history on connect or requiring the client to call the history REST endpoint – we can choose the more efficient method during implementation (likely pushing on connect to avoid race conditions).
Persistence Across Restarts: Not required in the first iteration
GitHub
. In-memory session state is acceptable, leveraging the existing file-based long-term memory to retain learned knowledge. We may add simple periodic dump of the conversation to a file for safety, but a true database or restart-resume of a conversation can be left for later. If the process restarts, the assistant effectively starts a new session (with long-term memory loaded from disk, so it’s not starting from scratch intellectually).
Interface for Other Channels: Use a unified internal API for external messages (like SessionManager.handleMessage(source, content))
GitHub
. The SessionManager will act as the central router so that an incoming email or chat message is treated equivalently to a WebSocket message. Implement channel listeners (polling, webhooks, etc.) that feed into this API. We’ll include source metadata for logging and UI labeling but otherwise keep logic unified. The assistant’s responses can be sent out via the appropriate channel (e.g., email reply), which will require implementing send capability for those channels in the future.
Server Terminal Input: Utilize Node’s readline on stdin to capture console input and inject it into the SessionManager
GitHub
. This gives the operator a way to type queries directly. The SessionManager will print responses to stdout. This effectively treats the console as another “client” (though implemented differently than WebSockets). Care will be taken to keep the console output readable alongside debug logs.
Cancellation UX: Introduce a cancel command/event that clients can invoke to abort a running request
GitHub
. The SessionManager will handle this by signaling the agent to stop (setting a flag to break out of loops or ignoring results). All clients will receive a notification when a cancel occurs so they stay in sync. The front-end should present a cancel option when busy and handle the resulting events (e.g., stop showing partial output when canceled).
User Presence & Notifications: Use the presence of connected real-time clients as an indicator of user availability
GitHub
. If at least one WebSocket is connected, deliver all events to those sockets immediately (the user will see them). If none are connected, the SessionManager still processes inputs (like an email) but there is no live viewer; the events accumulate in history. We may later add more nuanced presence detection (like tracking the last active channel), but initially broadcasting to all connected endpoints is sufficient. The agent will effectively function even if the user isn’t watching in real time, which is important – for example, it can still handle an email and maybe send a reply autonomously while you’re offline.
Conclusion and Next Steps
The proposed design is a solid foundation for turning the agent into a persistent, multi-modal assistant. By centralizing session state on the server and treating all inputs uniformly, we ensure continuity and a coherent personality across channels. The refinements above aim to clarify the behavior and fill in missing details, such as logging user messages, managing concurrency with a busy/queue system, and defining how exactly to implement channel integrations and timeouts. Key changes to implement:
Develop the SessionManager class/module to encapsulate session state (history, memory, connected clients, active task flag).
Refactor the WebSocket connection handling to use a single session (no per-connection session map). Remove the memory reset per new socket
GitHub
; instead, maybe reset only on explicit request or timeout.
Update event handling: one set of sharedEventEmitter listeners in SessionManager that broadcast events to all clients, and log history appropriately (include user messages, etc.).
Add support for a cancel message and implement checking of a cancel flag in the agent processing loop.
Implement the timeout using setTimeout or an activity timer that calls a handler to consolidate memory and clear history.
Adjust the front-end client to rely on server for history and handle new event types (user, busy, reset, etc.).
Set up basic scaffolding for external channel input (perhaps just a stub function or endpoint that can be extended for email/WhatsApp).
Add the console input loop for direct terminal queries.
Before coding, it would be wise to review these changes with any stakeholders or the team, especially around how the UI will reflect the new behavior (to avoid any confusion when a user reconnects or when multiple devices are used). Once aligned, we can proceed to implement in increments (e.g., first get single-session working with one client, then add multi-client, then external channels, etc., verifying that at each step existing functionalities like memory and tool use continue to work properly). Please let me know if any of these refinements need further clarification or if there are additional concerns about the new architecture. Overall, these changes should bring the project much closer to the conceptual intent of a persistent assistant entity that is robust across disconnects and accessible from anywhere.
Citations
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L15-L23
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L25-L33
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L304-L313
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L316-L324
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L322-L330
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L27-L33
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L29-L33
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L336-L344
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L378-L385
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L22-L25
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L369-L378
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L424-L433
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L35-L41
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L36-L41
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L37-L41
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L390-L399
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L424-L432
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L43-L51
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L49-L57
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/core/memory/index.js#L9-L17
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/core/memory/index.js#L34-L42
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L51-L58
Favicon
agent_model.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/agent_model.md#L64-L72
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/core/memory/index.js#L54-L62
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/core/memory/index.js#L74-L82
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L66-L69
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L196-L205
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L232-L240
Favicon
index.js

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/src/index.js#L463-L471
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L73-L76
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L75-L78
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L75-L79
Favicon
server-session-design.md

https://github.com/adamd9/llm-agent/blob/61ff828c237f5f0cbd93c100aac14013e905ea6a/docs/server-session-design.md#L77-L80
All Sources

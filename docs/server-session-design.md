# Server-Side Session and State Management

## Overview

Currently the browser client maintains session state and message history. If the browser disconnects, the in‑progress task stops and the user loses any progress. We want the server to own the session so that:

* The agent keeps processing even if all clients disconnect.
* When a client reconnects it can fetch all progress and the final result.
* Multiple clients may connect simultaneously and share the same conversation and output.

This document sketches a design for implementing persistent server‑managed sessions.

## Proposed Architecture

### 1. Single Session Manager

* The server hosts a single long‑lived **SessionManager** instance.
* It stores:
  * State of the current request (if any)
  * Conversation history
  * Agent short‑ and long‑term memory
  * Connected WebSocket clients
* The manager accepts only one request at a time. If no task is running, the incoming message is processed immediately.
* Results and status updates are broadcast to every connected client.
* Input can originate from multiple channels (WebSocket UI, CLI, email, etc.) but they all share this single active session.

### 2. Connection Handling

* Clients connect via WebSocket and automatically join the shared session.
* On connection the server sends the session id and any buffered history/events so the client can render past progress.
* If a client disconnects, it is removed from the connection list but the session and any active request continue running.
* When the client reconnects it requests the buffered history to catch up.
* The manager tracks which real-time connections currently have a user present. Asynchronous events like incoming email should trigger alerts to those active channels.

### 3. Message Flow and Cancellation

1. Client sends a message → if no request is running, the server begins processing immediately.
2. If a message arrives while another request is active, the server responds that the session is busy.
3. The client may either wait or send a cancellation command to stop the active request so theirs can run next.
4. All events emitted by the agent (responses, system status, subsystem logs, errors) are persisted in the session history and pushed to every connected WebSocket.
5. Clients display updates as they arrive. Because the history is stored on the server, a reconnecting client can replay the history.

### 4. Persistence

* Initially the session can be kept in memory with optional periodic writes to disk for recovery.
* The existing `memory` module can continue to store short/long term data on disk; the session manager simply calls into it.
* Long‑term persistence (e.g., database) can be added later if needed.

### 5. Session Timeout and Consolidation

* Session memory lives for a configurable duration (default **30 minutes**).
* When the timeout is reached the short‑term memory is consolidated into long‑term storage and the conversation history is cleared.
* This consolidation step ensures that long‑term memory remains up‑to‑date while preventing unbounded growth of in‑memory history.
* After consolidation clients may immediately continue messaging which starts a fresh short‑term context.
* The timeout value should be exposed via a configuration option so deployments can adjust it.

## Implementation Notes

* `src/index.js` will be refactored so that session state (active request status, history, memory) lives outside the WebSocket connection lifecycle.
* A new `SessionManager` module will handle:
  * Adding/removing WebSocket clients
  * Accepting and processing user messages one at a time
  * Broadcasting events to all clients
  * Tracking which real-time channels have an active user so asynchronous updates can be directed there
  * Serving history on demand
* The front‑end will only manage UI state. It will send user messages and render events from the server; it no longer stores conversation history locally.
* A standalone CLI command (`npm run query`) runs its own session and exits once the response is returned.
* When the server process is running, the terminal it runs in should allow the operator to type queries that feed into the shared session after initialization completes.
* The session manager should expose a way to **cancel** the current request so a waiting client can begin processing immediately.

## Outstanding Questions

1. **Resolved:** a single global session is sufficient for now and no authentication is required.
2. How much history should be replayed to reconnecting clients (full log vs. last N events)?
3. Is persistence across server restarts required now, or is in‑memory storage acceptable for the first step?
4. What is the best interface for accepting messages from other channels (e.g., e‑mail or WhatsApp) so they also feed into the session manager?
5. What mechanism should be used to allow typing directly into the server terminal once initialization completes?
6. How should cancellation be surfaced to clients so they can interrupt a running request when necessary?
7. How should user presence be detected and maintained across channels so notifications reach the correct real-time connection?


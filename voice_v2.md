# Voice Input (STT) Implementation Plan: Client-Side with AssemblyAI

This document outlines the proposed implementation for adding Speech-to-Text (STT) capabilities to the application using AssemblyAI. The client will directly connect to AssemblyAI for STT processing. Text-to-Speech (TTS) for agent responses will be considered as a future enhancement.

**Security Notice:** For the initial implementation, the client will use the main AssemblyAI API key directly. This is a temporary measure for simplicity and carries security risks. It should be replaced with a backend-generated temporary token system as a high-priority follow-up task.

## 1. High-Level Architecture (Client-Side STT)

The system will leverage two WebSocket connections for the client:
1.  The existing main WebSocket for chat messages and general agent communication with our backend.
2.  A **direct WebSocket connection from the client to AssemblyAI's streaming STT service.**

### 1.1. Frontend (Client-Side)

*   **API Key Management (Initial - Insecure):**
    *   The full AssemblyAI API key will be embedded in the client-side JavaScript.
    *   **TODO:** Replace this with a system where the client requests a short-lived temporary token from our backend.
*   **Audio Capture:**
    *   Utilize `navigator.mediaDevices.getUserMedia()` to request microphone access.
    *   Employ the `MediaRecorder` API to capture audio (e.g., in WebM/Opus format, as AssemblyAI's JS SDK can handle this).
*   **STT Connection to AssemblyAI:**
    *   Using the AssemblyAI JavaScript SDK, the client will establish a direct WebSocket connection to AssemblyAI's streaming STT service (`wss://streaming.assemblyai.com/v3/stream`).
    *   The client will authenticate this connection using the embedded (full) AssemblyAI API key.
*   **Streaming Audio to AssemblyAI:**
    *   Captured audio data from `MediaRecorder` will be streamed directly from the client to AssemblyAI via the AssemblyAI JS SDK.
*   **Receiving Transcripts from AssemblyAI:**
    *   The client will receive real-time events from AssemblyAI, including partial transcripts and final transcripts (`TurnEvent` with `end_of_turn: true`).
*   **Displaying Partial Transcripts (UX):**
    *   Partial transcripts can be displayed in the client UI for immediate user feedback.
*   **Sending Final Transcript to Backend Agent:**
    *   Once a `TurnEvent` with `end_of_turn: true` is received, the client will take the final `transcript`.
    *   This final transcript text will be sent to our backend server via the **existing main chat WebSocket connection** (e.g., as a standard chat message), associated with the current `sessionId`.

### 1.2. Backend (Server-Side)

*   **Role in STT:**
    *   The backend's primary role in STT is minimal in this client-side approach. It does *not* handle audio streaming for STT.
    *   **TODO (for temporary tokens):** Implement an endpoint to generate and provide temporary AssemblyAI tokens to the client.
*   **Receiving Final Transcript:**
    *   The backend's existing main chat WebSocket handler will receive the final transcript text from the client.
*   **Agent Interaction:**
    *   The transcribed text is passed to the core AI agent/LLM for processing, just like any other typed user message.
*   **Text-to-Speech (TTS) Integration:**
    *   (Future Enhancement)

## 2. WebSocket Message Protocols

### 2.1. Client <-> AssemblyAI WebSocket (Managed by AssemblyAI JS SDK)

*   This communication is handled by the AssemblyAI JS SDK. We will interact with the SDK's event model.

### 2.2. Existing Main Chat WebSocket (Client <-> Our Backend)

*   **Client -> Server: `user_message` (Existing or similar JSON message)**
    *   Payload: `{ "type": "user_message", "text": "This is the final transcript from STT.", "sessionId": "..." }`
    *   Purpose: Client sends the finalized STT transcript to the agent.
*   **Client -> Server: `set_voice_input_mode` (JSON - Optional, for UI state synchronization)**
    *   Payload: `{ "enabled": boolean }`
    *   Purpose: Client informs the server about its voice input state, primarily for logging or if the server needs to be aware for other reasons (not strictly necessary for client-side STT).
*   **Server -> Client: `voice_input_status` (JSON - Optional, for advanced feedback)**
    *   Payload: `{ "status": "stt_error_backend", "message": "Backend could not process request related to voice." }`
    *   Purpose: For any server-side issues related to voice mode, if any. Most STT feedback will be client-side.

## 3. Key Technologies & APIs

*   **Frontend:**
    *   `navigator.mediaDevices.getUserMedia()`
    *   `MediaRecorder` API (outputting WebM/Opus)
    *   WebSocket API (for main chat connection)
    *   **AssemblyAI JavaScript SDK:** For direct STT streaming to AssemblyAI.
*   **Backend:**
    *   WebSocket server library (e.g., `ws` for Node.js) for the main chat endpoint.
*   **AssemblyAI Streaming STT API:**
    *   Documentation: [https://www.assemblyai.com/docs/speech-to-text/universal-streaming](https://www.assemblyai.com/docs/speech-to-text/universal-streaming)
    *   JS SDK will handle connection to `wss://streaming.assemblyai.com/v3/stream`.

## 4. Implementation Steps (Client-Side STT)

1.  **Frontend - API Key Setup (Initial - Insecure):**
    *   Store the full AssemblyAI API key in a client-accessible configuration.
    *   **Action Item:** Create a high-priority task to replace this with a temporary token system.
2.  **Frontend - UI & AssemblyAI SDK Integration:**
    *   Add AssemblyAI JavaScript SDK to the project.
    *   Implement UI for voice input toggle button and status indicators (e.g., "Listening...", "Processing...", partial transcript display).
3.  **Frontend - Audio Capture & Streaming to AssemblyAI:**
    *   When voice input is enabled:
        *   Use `MediaRecorder` to capture audio.
        *   Initialize AssemblyAI's `StreamingClient` (or equivalent from their JS SDK) with the API key and desired parameters (e.g., `sampleRate` if the SDK requires it, though it often auto-detects or works with common web formats).
        *   Stream audio data from `MediaRecorder` to the AssemblyAI SDK.
4.  **Frontend - Handling AssemblyAI Events:**
    *   Listen for `TurnEvent` (or similar) from the AssemblyAI SDK.
    *   Display partial transcripts in the UI.
    *   When `end_of_turn: true`, extract the final `transcript`.
    *   Send this final transcript to the backend via the main chat WebSocket.
    *   Handle errors and other relevant events from the AssemblyAI SDK and update UI.
5.  **Backend - Agent Integration:**
    *   Ensure the existing agent logic in `src/ego/ego.js` (or relevant message handler) correctly processes the incoming text message containing the STT transcript. No major changes expected here as it's just another text input.
6.  **Error Handling & Refinements:** Implement robust error handling for microphone access, AssemblyAI connection, and SDK errors on the client-side.

## 5. Frontend Implementation Details (Client-Side STT)

### 5.1. Core Components & State (`public/js/chat.js` or similar)

*   **Main WebSocket Connection:** Existing `ws` instance.
*   **AssemblyAI API Key:** Variable holding the API key (e.g., `const ASSEMBLYAI_API_KEY = "YOUR_FULL_API_KEY";`). **REMINDER: This is temporary and insecure.**
*   **AssemblyAI StreamingClient:** Instance of AssemblyAI's client (e.g., `let assemblyAIClient;`).
*   **Voice Input Mode State:** Local boolean (e.g., `isVoiceInputActive = false;`).
*   **MediaRecorder Instance:** `let mediaRecorder;`.
*   **Audio Stream:** `let audioStream;` (from `getUserMedia`).

### 5.2. UI Elements & Event Handlers

*   **Voice Input Toggle Button:**
    *   HTML: `<button id="voiceInputToggle">Enable Voice Input</button>`.
    *   Event Listener:
        *   Toggles `isVoiceInputActive`.
        *   If enabling: calls `startVoiceInput()`.
        *   If disabling: calls `stopVoiceInput()`.
        *   Updates UI (button text/icon, status indicator).
*   **Chat Input Field:** The existing main chat input field (e.g., `<input type="text" id="chatInput">`).
*   **"Auto-send on Speech End" Toggle:**
    *   HTML: `<input type="checkbox" id="autoSendToggle" checked><label for="autoSendToggle">Auto-send on speech end</label>` (or a more sophisticated toggle switch).
    *   State: `let isAutoSendEnabled = true;` (managed by the toggle).
*   **Status Indicator:** HTML element to show "Listening...", "Processing...", errors. (Partial transcripts will now go to the chat input).

### 5.3. Voice Input Logic

1.  **`async startVoiceInput()`:**
    *   If already active, return.
    *   Get the chat input element (e.g., `const chatInputField = document.getElementById('chatInput');`).
    *   Request microphone: `audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });`.
    *   Initialize AssemblyAI `StreamingClient` with `apiKey: ASSEMBLYAI_API_KEY` and event handlers:
        *   `onTurn`: Receives `TurnEvent`.
            *   Update `chatInputField.value = event.transcript;` (This handles both partial and final transcripts for the current turn. For multiple turns in one recording, decide if append or replace is better. Replacing per turn might be simpler to start).
            *   If `event.end_of_turn`:
                *   If `isAutoSendEnabled` (from the toggle state):
                    *   Simulate sending the chat message (e.g., call the existing function that handles sending chat input, then clear `chatInputField`).
                    *   `// Example: sendMessage(chatInputField.value); chatInputField.value = '';`
                *   Else (auto-send is off):
                    *   Ensure `chatInputField` has the final transcript.
                    *   Optionally, `chatInputField.focus();` to allow user to edit/send.
        *   `onError`: Handle STT errors, update UI status indicator.
        *   `onOpen`: Update UI, AssemblyAI connected.
        *   `onClose`: Update UI, AssemblyAI disconnected.
    *   Connect the `StreamingClient` to AssemblyAI.
    *   Create `mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm; codecs=opus' });` (or as recommended by AssemblyAI JS SDK).
    *   `mediaRecorder.ondataavailable = (event) => { if (assemblyAIClient && event.data.size > 0 && assemblyAIClient.isOpen()) assemblyAIClient.sendAudio(event.data); };` // Check if client is open
    *   `mediaRecorder.start(250);` (e.g., timeslice of 250ms).
    *   Update UI status indicator to "Listening...".
    *   Clear the chat input field: `chatInputField.value = '';`
2.  **`stopVoiceInput()`:**
    *   If `mediaRecorder && mediaRecorder.state === 'recording'`, `mediaRecorder.stop()`.
    *   If `assemblyAIClient && assemblyAIClient.isOpen()`, signal end of stream (`assemblyAIClient.endStream()`) and then close connection (`assemblyAIClient.close()`).
    *   If `audioStream`, stop all tracks: `audioStream.getTracks().forEach(track => track.stop());`.
    *   Reset `isVoiceInputActive`, `mediaRecorder`, `assemblyAIClient`, `audioStream`.
    *   Update UI.

## 6. Backend Implementation Details (Client-Side STT)

*   **No new WebSocket endpoint needed for STT audio.**
*   **No `sttService.js` needed for relaying audio.**
*   **`src/index.js` (Main Application File):**
    *   The existing WebSocket message handler for the main chat connection will receive the final transcript as a regular text message from the client. It should already be capable of passing this to the agent.
*   **TODO (for temporary tokens):**
    *   Add a new HTTP endpoint (e.g., `/api/assemblyai-token`).
    *   This endpoint will use the server-stored main AssemblyAI API key to request a temporary token from AssemblyAI's API.
    *   It will return this temporary token to the client.

## 7. Future Enhancements

*   **Implement Temporary Token System:** High priority.
*   Text-to-Speech (TTS) integration for agent voice responses.
*   Client-side UI for selecting microphone.
*   More sophisticated UI feedback for STT states and errors.

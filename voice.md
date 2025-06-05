# Bidirectional Voice Streaming Implementation Plan

This document outlines the proposed implementation for adding bidirectional voice streaming capabilities to the application, allowing users to talk to the agent and hear the agent's responses.

## 1. High-Level Architecture

The system will leverage WebSockets for real-time audio data transfer between the frontend (client) and the backend (server).

### 1.1. Frontend (Client-Side)

*   **Audio Capture:** 
    *   Utilize `navigator.mediaDevices.getUserMedia()` to request microphone access.
    *   Employ the `MediaRecorder` API to capture audio from the user's microphone.
*   **Audio Encoding:** 
    *   `MediaRecorder` can be configured to output audio in a suitable format (e.g., WebM container with Opus codec, which is efficient for voice).
*   **Sending Audio to Backend:**
    *   Captured audio data will be sent in chunks over the existing WebSocket connection to the backend.
    *   A specific WebSocket message type (e.g., `client_audio_chunk`) will be used.
*   **Receiving Audio from Backend:**
    *   The frontend will listen for audio chunks sent from the backend (e.g., `server_audio_chunk`).
*   **Audio Playback:**
    *   Use the `AudioContext` API (`createBufferSource()`, `decodeAudioData()`) to decode and play back the received audio stream in real-time.

### 1.2. Backend (Server-Side)

*   **Receiving Audio from Client:**
    *   The WebSocket server will listen for incoming `client_audio_chunk` messages.
    *   Audio chunks will be assembled or streamed directly to an STT service.
*   **Speech-to-Text (STT) Integration:**
    *   Client audio streamed via WebSockets will be relayed by the backend to the OpenAI Whisper API (`v1/audio/transcriptions`) using its native streaming support.
    *   The backend will receive real-time transcription updates (e.g., `transcript-text-delta-event`) and final transcriptions (e.g., `transcript-text-done-event`) from the API.
*   **Agent Interaction:**
    *   The transcribed text from the STT service is passed to the core AI agent/LLM for processing, similar to how text input is currently handled.
*   **Text-to-Speech (TTS) Integration:**
    *   The agent's textual response is sent to a TTS service (specifically OpenAI TTS API, given existing OpenAI integration).
    *   The TTS service converts the text response into an audio stream (e.g., MP3, Opus).
*   **Sending Audio to Client:**
    *   The synthesized audio stream from the TTS service is chunked and sent back to the client via WebSocket messages (e.g., `server_audio_chunk`).

## 2. WebSocket Message Protocol Enhancements

New message types will be introduced to handle audio data and mode switching:

*   `client_audio_chunk`: 
    *   Direction: Client -> Server
    *   Payload: Binary audio data (e.g., a Blob or ArrayBuffer segment).
    *   Metadata (optional): sequence number, timestamp.
*   `server_audio_chunk`:
    *   Direction: Server -> Client
    *   Payload: Binary audio data.
    *   Metadata (optional): sequence number, audio format details if not pre-negotiated.
*   `audio_stream_start` (Optional):
    *   Direction: Client -> Server (for user speech) / Server -> Client (for agent speech)
    *   Purpose: Signals the beginning of an audio transmission. Can include metadata like audio format, sample rate.
*   `audio_stream_end` (Optional):
    *   Direction: Client -> Server / Server -> Client
    *   Purpose: Signals the end of an audio transmission.
*   `set_audio_mode`:
    *   Direction: Client -> Server
    *   Payload: `{ enabled: boolean }`
    *   Purpose: Client informs the server to enable or disable audio mode for the current session.
*   `audio_mode_status`:
    *   Direction: Server -> Client
    *   Payload: `{ enabled: boolean, status: 'success' | 'error', message?: string }`
    *   Purpose: Server confirms the audio mode change or reports an error.

## 3. Key Technologies & APIs

*   **Frontend:**
    *   `navigator.mediaDevices.getUserMedia()`
    *   `MediaRecorder` API
    *   `AudioContext` API (for playback)
    *   WebSocket API
*   **Backend:**
    *   WebSocket server library (e.g., `ws` for Node.js)
    *   STT Service API (OpenAI Whisper API)
    *   TTS Service API (OpenAI TTS API)
*   **Audio Codecs:** Opus (preferred for quality and low latency), AAC, MP3.

### 3.1. OpenAI API Endpoints & Documentation

The primary reference for the OpenAI Audio APIs (including Speech-to-Text/Transcriptions and Text-to-Speech) can be found here:

*   **OpenAI Audio API Reference:** [https://platform.openai.com/docs/api-reference/audio](https://platform.openai.com/docs/api-reference/audio)
    *   **Speech-to-Text (STT):** We will use the OpenAI Whisper `v1/audio/transcriptions` endpoint, leveraging its native streaming capabilities. Audio data will be streamed from the client, through our backend, to this endpoint. The backend will process events like `transcript-text-delta-event` for real-time partial transcription updates and `transcript-text-done-event` to finalize transcription segments. For detailed API usage, refer to the [Create Transcription API documentation](https://platform.openai.com/docs/api-reference/audio/createTranscription).
    *   **Text-to-Speech (TTS):** We will use the `v1/audio/speech` endpoint (OpenAI TTS). This API supports streaming the output audio, which will be leveraged for responsive playback.

## 4. Implementation Steps (High-Level)

(See Section 5 for detailed Frontend steps and Section 7 for detailed Backend steps)

1.  **Frontend - Audio Mode UI & Controls:** Implement UI for audio mode toggle, microphone access, and recording status.
2.  **Frontend - Audio Capture & Streaming:** Configure `MediaRecorder` and stream audio chunks via WebSocket when audio mode is active.
3.  **Backend - Audio Mode & State Management:** Implement server-side logic to manage audio mode per session.
4.  **Backend - STT Integration:** Relay client audio to OpenAI Whisper, process transcription events, and feed text to `ego`.
5.  **Backend - TTS Integration:** Route `ego`'s text responses to OpenAI TTS and stream synthesized audio back to the client.
6.  **Frontend - Audio Playback:** Receive TTS audio chunks from WebSocket and play them using `AudioContext`.
7.  **Refinements:** Implement robust error handling, latency optimization, and user feedback mechanisms throughout.

## 5. Frontend Implementation Details

This section details the client-side JavaScript implementation, likely residing in a file within the `public` directory (e.g., `public/js/main.js` or similar, based on `express.static('public')` in `src/index.js`).

### 5.1. Core Components & State

*   **WebSocket Connection:** Maintain the existing WebSocket connection to the server.
*   **Audio Mode State:** A local boolean variable (e.g., `isAudioModeActive = false;`) to track if audio mode is enabled by the user.
*   **MediaRecorder Instance:** Variable to hold the `MediaRecorder` object when active (e.g., `let mediaRecorder;`).
*   **AudioContext Instance:** Variable for `AudioContext` for playback (e.g., `let audioContext;`).
*   **Audio Buffer Queue (for playback):** An array to queue incoming audio chunks from the server before they are decoded and played, to ensure smooth playback (e.g., `let playbackQueue = [];`).
*   **Is Playing Flag:** A boolean to manage playback state (e.g., `let isPlayingAudio = false;`).

### 5.2. UI Elements & Event Handlers

*   **Audio Mode Toggle Button:**
    *   An HTML button (e.g., `<button id="audioModeToggle">Toggle Audio Mode</button>`).
    *   Event listener for this button:
        *   Toggles the `isAudioModeActive` state.
        *   Sends a `set_audio_mode` message to the backend: `ws.send(JSON.stringify({ type: 'set_audio_mode', payload: { enabled: isAudioModeActive } }));`
        *   Updates UI to reflect current mode (e.g., button text/icon, recording indicator).
        *   If enabling audio mode, calls a function to initialize audio capture (see 5.3).
        *   If disabling audio mode, calls a function to stop audio capture.
*   **Recording Indicator:** A visual element (e.g., a blinking red dot) to show when the microphone is actively recording and sending data.

### 5.3. Audio Capture & Sending (When Audio Mode is Enabled)

1.  **Initialization (`initAudioCapture()`):
    *   Check if `isAudioModeActive` is true.
    *   Request microphone permission: `navigator.mediaDevices.getUserMedia({ audio: true })`.
    *   Handle success: 
        *   Create `MediaRecorder` instance with the stream: `mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm; codecs=opus' });` (or other suitable mimeType).
        *   Attach `ondataavailable` event handler to `mediaRecorder`.
        *   Attach `onstop` event handler to `mediaRecorder`.
        *   Optionally send `audio_stream_start` to server: `ws.send(JSON.stringify({ type: 'audio_stream_start', payload: { format: 'webm/opus', sampleRate: 48000 } }));` (sampleRate might be obtained from stream or set).
        *   Start recording: `mediaRecorder.start(500);` (e.g., timeslice of 500ms to get chunks frequently).
        *   Update UI (recording indicator on).
    *   Handle error (permission denied, no microphone): Inform user, ensure audio mode is reset to off.
2.  **`mediaRecorder.ondataavailable` Event Handler:**
    *   When a chunk of audio data is available (`event.data` is a Blob).
    *   If WebSocket is open and `isAudioModeActive` is true, send the blob directly: `ws.send(event.data);` (The backend will expect binary data after `audio_stream_start` or based on session state).
3.  **Stopping Audio Capture (`stopAudioCapture()`):
    *   If `mediaRecorder` and `mediaRecorder.state === 'recording'`:
        *   `mediaRecorder.stop();` (This will trigger one last `ondataavailable` with remaining data, then `onstop`).
    *   Update UI (recording indicator off).
    *   Optionally send `audio_stream_end` to server: `ws.send(JSON.stringify({ type: 'audio_stream_end' }));`
    *   Release microphone: If `mediaRecorder` has a stream, iterate `stream.getTracks().forEach(track => track.stop());`.
    *   Set `mediaRecorder = null;`

### 5.4. Receiving & Playing Back TTS Audio

1.  **WebSocket `onmessage` Handler (Extension):
    *   The existing `ws.onmessage` handler needs to differentiate between JSON messages and binary audio data from the server.
    *   If `event.data` is a string, parse as JSON (current behavior).
        *   If JSON message type is `audio_mode_status`, update UI/state based on success/failure.
        *   If JSON message type is `server_audio_stream_start`, prepare for incoming audio chunks (e.g., initialize `audioContext` if not already, clear `playbackQueue`).
        *   If JSON message type is `server_audio_stream_end`, signal that no more audio chunks are expected for the current playback.
    *   If `event.data` is a Blob or ArrayBuffer (binary audio chunk from TTS):
        *   Add the chunk to `playbackQueue`.
        *   Call a function to process the playback queue (e.g., `processPlaybackQueue()`).
2.  **Audio Playback Logic (`processPlaybackQueue()`):
    *   If `isPlayingAudio` is true or `playbackQueue` is empty, return.
    *   Set `isPlayingAudio = true;`
    *   Take the next chunk (ArrayBuffer/Blob) from `playbackQueue`.
    *   Ensure `audioContext` is initialized: `if (!audioContext) audioContext = new AudioContext();`
    *   Convert Blob to ArrayBuffer if necessary.
    *   Decode the audio data: `audioContext.decodeAudioData(arrayBuffer, (buffer) => { ... });`
    *   Inside the `decodeAudioData` callback:
        *   Create a buffer source: `const source = audioContext.createBufferSource(); source.buffer = buffer;`
        *   Connect to destination: `source.connect(audioContext.destination);`
        *   Set an `onended` event for the source: `source.onended = () => { isPlayingAudio = false; processPlaybackQueue(); };` (Plays next chunk when current one finishes).
        *   Start playback: `source.start();`
    *   Handle `decodeAudioData` errors: Log error, set `isPlayingAudio = false;`, try next chunk or clear queue.

### 5.5. Initial State

*   On page load, audio mode should be off. The user must explicitly enable it.
*   WebSocket connection should be established as it is currently.

1.  **Frontend - Audio Capture & Sending:**
    *   Implement UI for microphone permission and recording control.
    *   Capture audio using `MediaRecorder`.
    *   Send audio chunks via WebSocket.
2.  **Backend - Receiving Audio & STT:**
    *   Handle incoming audio chunks on WebSocket server.
    *   Integrate with an STT service to transcribe audio to text.
3.  **Backend - TTS & Sending Audio:**
    *   Integrate with a TTS service to convert agent's text response to audio.
    *   Send synthesized audio chunks back to the client via WebSocket.
4.  **Frontend - Receiving Audio & Playback:**
    *   Receive audio chunks from WebSocket.
    *   Use `AudioContext` to play back the audio stream.
5.  **Refinements:** Implement robust error handling, latency optimization, and user feedback mechanisms.

## 6. Audio Mode Management

To provide user control over voice interaction, an "audio mode" will be implemented.

### 6.1. Frontend UI

*   A clear visual toggle (e.g., a microphone icon button or a switch) will be added to the frontend UI.
*   This toggle allows the user to explicitly enable or disable audio input (microphone) and audio output (agent voice playback).
*   When audio mode is enabled, the UI should provide feedback (e.g., recording indicator).

### 6.2. Client-Backend Signaling

*   When the user toggles the audio mode on the frontend, a `set_audio_mode` WebSocket message is sent to the backend with the desired state (`{ enabled: true/false }`).
*   The backend responds with an `audio_mode_status` message confirming the change or indicating an error (e.g., if STT/TTS services are unavailable).

### 6.3. Backend State & Logic

*   The backend will maintain an `isAudioModeEnabled` state for each active `sessionId`.
*   **Entering Audio Mode:**
    *   When `set_audio_mode({ enabled: true })` is received, the backend prepares to handle audio.
    *   It may pre-initialize connections or configurations for STT for that session.
    *   Subsequent `client_audio_chunk` messages will be processed for STT.
    *   Agent responses generated while in audio mode will default to being synthesized via TTS and streamed back as audio.
*   **Exiting Audio Mode:**
    *   When `set_audio_mode({ enabled: false })` is received, the backend stops processing incoming audio for STT for that session.
    *   Any active STT stream for the session should be gracefully terminated.
    *   Agent responses will revert to text-based delivery unless specifically requested otherwise.
*   **Default Mode:** The application will likely start in text-only mode.

## 7. Backend Integration Details (with `src/index.js`)

This section outlines how the audio streaming features will be integrated into the existing Node.js backend structure found in `src/index.js`.

### 7.1. WebSocket Message Handling (`wss.on('connection', ... ws.on('message', ...)`)

*   **Differentiating Message Types:** The `ws.on('message', callback)` handler will need to distinguish between:
    *   Standard JSON messages (existing commands, `set_audio_mode`).
    *   Binary audio data chunks (sent by the client when audio mode is active and microphone is capturing).
    *   A common pattern is for the client to send an `audio_stream_start` JSON message, then raw binary audio frames, then an `audio_stream_end` JSON message. The server would need to be stateful per session to know when to expect binary data.
*   **Audio Mode State:** The `isAudioModeEnabled` flag for the session (see Section 6.3) will gate the processing of binary audio data and the initiation of STT/TTS.

### 7.2. STT Service Integration

*   **Initiation:** When a session enters audio mode and `audio_stream_start` (or the first audio chunk) is received, the backend will initiate a streaming connection to the OpenAI Whisper API (`v1/audio/transcriptions`) for that session.
*   **Data Forwarding:** Incoming binary audio chunks from the client's WebSocket will be forwarded to this OpenAI STT stream.
*   **Event Handling:** The backend will listen for `transcript-text-delta-event` and `transcript-text-done-event` from the Whisper API.
*   **Passing to Ego:** Completed transcription segments (or significant partials) will be passed to `ego.processMessage(transcribedText, sessionHistory)`, potentially via a new internal event on `sharedEventEmitter` or by adapting `ego.processMessage` to accept an indicator that the input is from STT.

### 7.3. TTS Service Integration

*   **Triggering TTS:** When `ego` generates a response and the session is in audio mode, the text response will be routed to a TTS service.
*   **Streaming to Client:** The TTS service will connect to the OpenAI TTS API (`v1/audio/speech`). As audio chunks are received from OpenAI, they will be sent to the client via its WebSocket connection. This can leverage the existing `messageQueue` and `processQueue` logic in `src/index.js`, by queueing binary audio data. The client should be signaled first (e.g., with `server_audio_stream_start`).

### 7.4. Conceptual New Modules (to be created in `src/`)

To keep `src/index.js` clean and modularize functionality:

*   `src/services/sttService.js` (or similar):
    *   Manages streaming connections to OpenAI Whisper for active audio sessions.
    *   Handles audio data forwarding and processing of transcription events.
    *   Interacts with `ego` or `sharedEventEmitter` to deliver transcriptions.

#### 7.4.1. `sttService.js` - Detailed Design

This service will encapsulate all logic related to streaming audio to the OpenAI Whisper API for transcription.

*   **Structure:** Implemented as a singleton module.
*   **Dependencies:** `openai` (for Whisper API), `logger` (for logging), potentially `sharedEventEmitter` (for broadcasting transcription events).
*   **State Management:** 
    *   Maintains a map of active STT streams, e.g., `activeStreams = new Map();` where keys are `sessionId` and values are objects containing the Whisper stream instance and related state (e.g., a buffer for incoming audio if Whisper client requires it, current transcription state).

*   **Core Responsibilities & Methods:**

    *   **`async initializeStream(sessionId, audioConfig)`:**
        *   Called by `src/index.js` when a client session enters audio mode and is ready to send audio.
        *   `audioConfig` might include expected format, sample rate if needed by the API (though Whisper is generally robust).
        *   Initiates a streaming transcription request to OpenAI Whisper API (`client.audio.transcriptions.create({ model: 'whisper-1', language: 'en', stream: true, ... })`).
        *   The actual audio data will be piped/written to the request stream provided by the OpenAI SDK.
        *   Stores the stream and associated data (e.g., a writable stream part of the OpenAI request) in `activeStreams` for the `sessionId`.
        *   Sets up event listeners on the Whisper response stream for `data` (containing events like `transcript-text-delta-event`, `transcript-text-done-event`), `error`, and `end`.

    *   **`async processAudioChunk(sessionId, chunk)`:**
        *   Called by `src/index.js` when a binary audio chunk is received from the client.
        *   Retrieves the active Whisper stream for the `sessionId`.
        *   Writes/forwards the `chunk` (which should be an ArrayBuffer or Buffer) to the Whisper API request stream.
        *   Handles backpressure if necessary.

    *   **`async finalizeStream(sessionId)`:**
        *   Called by `src/index.js` when the client signals the end of audio transmission (e.g., `audio_stream_end` message) or audio mode is disabled.
        *   Signals the end of the input stream to the Whisper API (e.g., by calling `end()` on the writable stream part of the request).
        *   The Whisper API will then finalize transcription and send any remaining `transcript-text-done-event`.

    *   **Whisper Event Handling (internal to the service, for each stream):**
        *   On `transcript-text-delta-event` (from Whisper stream data):
            *   Extract the partial transcript text.
            *   Emit an event (e.g., via `sharedEventEmitter` or a direct callback registered by `src/index.js`) like `stt_partial_transcript` with `{ sessionId, partialText }`. This allows `src/index.js` to forward it to the client for real-time feedback if desired (via a new WebSocket message type like `server_stt_update`).
        *   On `transcript-text-done-event` (from Whisper stream data):
            *   Extract the final transcript segment.
            *   Emit an event like `stt_final_transcript` with `{ sessionId, finalText }`.
            *   `src/index.js` will listen for this and then call `ego.processMessage(finalText, sessionHistory)`.
        *   On `error` (from Whisper stream):
            *   Log the error.
            *   Emit an error event (e.g., `stt_error` with `{ sessionId, error }`).
            *   Clean up the stream for the `sessionId` from `activeStreams`.
            *   `src/index.js` can then inform the client.
        *   On `end` (from Whisper stream):
            *   Clean up the stream for the `sessionId` from `activeStreams`.
            *   Log stream completion.

*   **Interaction with `src/index.js`:**
    *   `src/index.js` instantiates or imports the `sttService` singleton.
    *   On WebSocket events related to audio mode and audio data, `src/index.js` calls the appropriate `sttService` methods (`initializeStream`, `processAudioChunk`, `finalizeStream`).
    *   `src/index.js` listens for events emitted by `sttService` (`stt_partial_transcript`, `stt_final_transcript`, `stt_error`) to act accordingly (forward to client, pass to `ego`, handle errors).

*   **Error Handling Specifics:**
    *   Handle API errors from OpenAI (rate limits, authentication, invalid requests) by logging and emitting `stt_error`.
    *   Manage stream lifecycle robustly, ensuring streams are closed and resources are released on error or completion.
*   `src/services/ttsService.js` (or similar):
    *   Takes text input.
    *   Manages streaming connections to OpenAI TTS.
    *   Handles sending synthesized audio chunks back to the client via their WebSocket (possibly by interacting with `wsConnections` and `messageQueue` from `src/index.js`).

#### 7.4.2. `ttsService.js` - Detailed Design

This service will handle the conversion of text responses from the agent into audible speech using the OpenAI TTS API and stream it to the client.

*   **Structure:** Implemented as a singleton module.
*   **Dependencies:** `openai` (for TTS API), `logger`, `wsConnections` (from `src/index.js` to get client WebSocket), `messageQueue` and `processQueue` (from `src/index.js` for sending data to client).
*   **State Management:** Minimal state, primarily managing the lifecycle of individual TTS requests.

*   **Core Responsibilities & Methods:**

    *   **`async streamTextToSpeech(sessionId, text, voiceOptions)`:**
        *   Called by `src/index.js` when `ego` produces a text response and the session is in audio mode.
        *   `voiceOptions` could include preferred voice, model (e.g., `tts-1`, `tts-1-hd`), audio format (e.g., `mp3`, `opus`). Defaults should be sensible.
        *   Retrieves the client's WebSocket connection using `wsConnections.get(sessionId)`.
        *   If no WebSocket connection, logs an error and returns.
        *   Initiates a streaming request to OpenAI TTS API (`client.audio.speech.create({ model: 'tts-1', voice: 'alloy', input: text, response_format: 'opus', ... })`). The OpenAI SDK should provide a readable stream for the audio output.
        *   Sends a `server_audio_stream_start` WebSocket message to the client (via `messageQueue` and `processQueue`) to signal the beginning of TTS audio. This message could include metadata like audio format if not fixed.
        *   Listens for `data` events on the OpenAI TTS response stream. Each `data` event will provide a chunk of audio data (e.g., an ArrayBuffer or Buffer).
            *   For each audio chunk received from OpenAI:
                *   Queue the binary audio chunk to be sent to the client using the `messageQueue.get(sessionId).push(audioChunk)` and then ensure `processQueue(sessionId)` is called (or let it run on its interval).
        *   Listens for `error` events on the OpenAI TTS stream:
            *   Logs the error.
            *   Sends an error message to the client if appropriate (e.g., `server_tts_error`).
            *   Ensures the `server_audio_stream_end` message is sent if the stream started.
        *   Listens for `end` events on the OpenAI TTS stream:
            *   Sends a `server_audio_stream_end` WebSocket message to the client (via `messageQueue`) to signal completion of the TTS audio.
            *   Logs successful TTS streaming completion.

*   **Interaction with `src/index.js`:**
    *   `src/index.js` instantiates or imports the `ttsService` singleton.
    *   When `ego` generates a response and the session is in audio mode, `src/index.js` calls `ttsService.streamTextToSpeech(sessionId, agentResponseText, ttsOptions)`.
    *   The `ttsService` uses `wsConnections` and `messageQueue` (passed in or imported from `src/index.js`) to directly send control messages and audio data to the client.

*   **Error Handling Specifics:**
    *   Handle API errors from OpenAI (rate limits, authentication, invalid input text, voice not found) by logging and potentially sending a `server_tts_error` message to the client.
    *   If the client WebSocket connection is lost mid-stream, gracefully terminate the OpenAI TTS request if possible and log the event.
    *   Ensure `server_audio_stream_end` is sent to the client even if errors occur after `server_audio_stream_start` was sent, to allow the client to clean up its playback state.

### 7.5. Configuration & Environment

*   The OpenAI API key (already likely in `.env` for `ego`) will be used by these new services.
*   Audio configuration parameters (e.g., sample rate, audio format for `MediaRecorder` and expected by Whisper) should be managed, possibly in a config file or environment variables.

### 7.6. Error Handling

*   Error handling within `sttService.js` and `ttsService.js` will be crucial.
*   Errors from OpenAI (API errors, connection issues) should be logged and, where appropriate, communicated to the client (e.g., via an `audio_mode_status` message or a generic error message).

## 8. Considerations

*   **Latency:** Minimize delays in STT, agent processing, and TTS for a natural conversational flow.
*   **Audio Quality:** Choose appropriate codecs and bitrates.
*   **Cost:** STT and TTS services are often priced per usage.
*   **Error Handling:** Gracefully handle microphone access denial, network interruptions, API errors from STT/TTS.
*   **Security:** Use WSS (Secure WebSockets) and manage API keys securely.
*   **User Experience:** Provide clear visual feedback for recording status, processing, and playback. Consider noise suppression and echo cancellation if possible.

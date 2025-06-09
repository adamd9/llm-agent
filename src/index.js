// Triggering nodemon restart
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const core = require('./core');
const WebSocket = require("ws");
const http = require("http");
const logger = require("./utils/logger");
const sharedEventEmitter = require("./utils/eventEmitter");
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const safeStringify = require('./utils/safeStringify');
const { loadSettings, saveSettings, loadRawSettings, defaultSettings } = require('./utils/settings');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Simple settings page
app.get('/settings', (req, res) => {
    const raw = loadRawSettings();
    const effective = loadSettings();
    const defaults = defaultSettings;
    const baseModel = defaults.llmModel;
    const html = `<!DOCTYPE html>
<html><head><title>Settings</title></head><body>
<h1>App Settings</h1>
<form method="POST" action="/settings">
  <label>LLM Model:<input type="text" name="llmModel" value="${raw.llmModel ?? ''}" placeholder="${defaults.llmModel}" /></label><br/>
  <label>Planner Model:<input type="text" name="plannerModel" value="${raw.plannerModel ?? ''}" placeholder="${defaults.plannerModel || baseModel}" /></label><br/>
  <label>Evaluator Model:<input type="text" name="evaluatorModel" value="${raw.evaluatorModel ?? ''}" placeholder="${defaults.evaluatorModel || baseModel}" /></label><br/>
  <label>Query Model:<input type="text" name="queryModel" value="${raw.queryModel ?? ''}" placeholder="${defaults.queryModel || baseModel}" /></label><br/>
  <label>Bubble Model:<input type="text" name="bubbleModel" value="${raw.bubbleModel ?? ''}" placeholder="${defaults.bubbleModel || baseModel}" /></label><br/>
  <label>Reflection Model:<input type="text" name="reflectionModel" value="${raw.reflectionModel ?? ''}" placeholder="${defaults.reflectionModel || baseModel}" /></label><br/>
  <label>Utterance Check Model:<input type="text" name="utteranceCheckModel" value="${raw.utteranceCheckModel ?? ''}" placeholder="${defaults.utteranceCheckModel}" /></label><br/>
  <label>LLM Max Tokens:<input type="number" name="maxTokens" value="${raw.maxTokens ?? ''}" placeholder="${defaults.maxTokens}" /></label><br/>
  <label>TTS Voice ID:<input type="text" name="ttsVoiceId" value="${raw.ttsVoiceId ?? ''}" placeholder="${defaults.ttsVoiceId}" /></label><br/>
  <label>TTS Model ID:<input type="text" name="ttsModelId" value="${raw.ttsModelId ?? ''}" placeholder="${defaults.ttsModelId}" /></label><br/>
  <label>STT Sample Rate:<input type="number" name="sttSampleRate" value="${raw.sttSampleRate ?? ''}" placeholder="${defaults.sttSampleRate}" /></label><br/>
  <label>STT Formatted Finals:<input type="checkbox" name="sttFormattedFinals" ${effective.sttFormattedFinals ? 'checked' : ''} /></label><br/>
  <button type="submit">Save</button>
</form>
</body></html>`;
    res.send(html);
});

app.post('/settings', (req, res) => {
    const newSettings = {};
    const assign = (field, transform) => {
        const val = req.body[field];
        if (val === undefined) return;
        if (val !== '') newSettings[field] = transform ? transform(val) : val;
    };

    assign('llmModel');
    assign('plannerModel');
    assign('evaluatorModel');
    assign('queryModel');
    assign('bubbleModel');
    assign('reflectionModel');
    assign('utteranceCheckModel');
    assign('maxTokens', v => parseInt(v, 10));
    assign('ttsVoiceId');
    assign('ttsModelId');
    assign('sttSampleRate', v => parseInt(v, 10));
    newSettings.sttFormattedFinals = req.body.sttFormattedFinals ? true : false;

    saveSettings(newSettings);
    res.redirect('/settings');
});

// Ensure .env variables are loaded
require('dotenv').config();

// --- AssemblyAI Temporary Token Endpoint ---
app.get('/api/assemblyai-token', (req, res) => {
  const apiKey = process.env.ASSEMBLY_AI_KEY;
  if (!apiKey) {
    logger.error('assemblyai-token', 'ASSEMBLY_AI_KEY not found in environment variables.');
    return res.status(500).json({ error: 'AssemblyAI API key not configured on server.' });
  }
  // For actual AssemblyAI V3, this should be exchanged for a temporary session token.
  // For now, returning the API key directly for testing.
  logger.debug('assemblyai-token', 'Returning AssemblyAI API key (for temporary testing).');
  const settings = loadSettings();
  res.json({
    token: apiKey,
    sampleRate: settings.sttSampleRate,
    formattedFinals: settings.sttFormattedFinals
  });
});
// --- End AssemblyAI Endpoint ---

// --- Start Utterance Check Endpoint ---
app.post('/api/utterance-check', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }
  try {
    const { getClient } = require('./utils/llmClient');
    const client = getClient('openai');
    const settings = loadSettings();
    const result = await client.chat([
      { role: 'system', content: 'Respond with JSON {"complete":true|false}. Determine if the user text represents a complete question or request.' },
      { role: 'user', content: text }
    ], {
      model: settings.utteranceCheckModel || 'gpt-4.1-nano',
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(result.content);
    res.json({ complete: !!parsed.complete });
  } catch (err) {
    logger.error('utterance-check', 'LLM check failed', err);
    res.status(500).json({ error: 'LLM check failed' });
  }
});

// +++ Start ElevenLabs TTS Streaming Endpoint +++
app.post('/api/tts/elevenlabs-stream', async (req, res) => {
    const settings = loadSettings();
    const {
        text,
        voice_id = settings.ttsVoiceId,
        model_id = settings.ttsModelId
    } = req.body;

    if (!text) {
        logger.error('elevenlabs-tts', 'Text is required for TTS.');
        return res.status(400).json({ error: 'Text is required.' });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    logger.debug('elevenlabs-tts', 'Using ElevenLabs API key:', { 
        keyPresent: !!apiKey,
        keyLength: apiKey ? apiKey.length : 0,
        keyPrefix: apiKey ? apiKey.substring(0, 5) + '...' : 'N/A'
    });
    
    if (!apiKey) {
        logger.error('elevenlabs-tts', 'ELEVENLABS_API_KEY not found in environment variables.');
        return res.status(500).json({ error: 'ElevenLabs API key not configured on server.' });
    }

    try {
        logger.debug('elevenlabs-tts', 'Requesting TTS stream from ElevenLabs', { text, voice_id, model_id });
        const elevenlabs = new ElevenLabsClient({ apiKey });

        const audioStream = await elevenlabs.textToSpeech.stream(voice_id, {
            text,
            model_id,
            output_format: 'mp3_44100_128', // Explicitly set output format
            // optimize_streaming_latency: 0, // Optional: latency optimization
        });

        res.setHeader('Content-Type', 'audio/mpeg'); // Adjust if you use a different output format

        // Pipe the stream to the response
        res.setHeader('Content-Type', 'audio/mpeg');
        for await (const chunk of audioStream) {
            res.write(chunk);
        }
        res.end();
        logger.debug('elevenlabs-tts', 'Successfully streamed all audio to client and ended response.');
    } catch (error) {
        logger.error('elevenlabs-tts', 'Error processing ElevenLabs TTS request', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to process TTS request.' });
        }
    }
});
// +++ End ElevenLabs TTS Streaming Endpoint +++

// Store sessions in memory (replace with proper storage in production)
const sessions = new Map();

// Store WebSocket connections by session ID
const wsConnections = new Map();

// Set WebSocket connections in logger
logger.setWSConnections(wsConnections);

// Get initial message from command line args
const initialMessage = process.argv[2];

// Initialize ego instance
const ego = new core.Ego(["llmquery", "file-system"]);

async function processInitialMessage() {
    if (!initialMessage) return;
    
    logger.debug("initial-message", "Processing initial message", { message: initialMessage });
    try {
        // Create a temporary session for the initial message
        const tempSessionId = `cli_${uuidv4()}`;
        const sessionHistory = [];
        
        // Initialize logger for this session
        await logger.initialize(tempSessionId);
        
        // Create promise to track message completion
        let messagePromise = new Promise((resolve) => {
            const messages = [];
            
            // Listen for debug responses
            const debugHandler = async (data) => {
                messages.push(data);
            };
            
            // Listen for completion
            const completionHandler = () => {
                sharedEventEmitter.off('debugResponse', debugHandler);
                sharedEventEmitter.off('assistantComplete', completionHandler);
                resolve(messages);
            };
            
            sharedEventEmitter.on('debugResponse', debugHandler);
            sharedEventEmitter.on('assistantComplete', completionHandler);
            
            // Process the message
            ego.processMessage(initialMessage, sessionHistory);
        });

        // Wait for message processing to complete
        const messages = await messagePromise;
        
        // Give a small delay to ensure all async operations complete
        // Wait a bit longer so reflection has time to finish
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        // Log final message location if we got any messages
        if (messages.length > 0) {
            logger.debug(`\nSession output saved to: ${logger.outputPath}`);
        }
        
        process.exit(0);
    } catch (error) {
        logger.error("initial-message", "Error processing initial message", error);
        process.exit(1);
    }
}

async function startServer() {
    // Initialize tool manager first
    const toolManager = require('./mcp');
    await toolManager.initialize();
    
    // Then initialize ego
    await ego.initialize();
    
    // If there's an initial message, process it and exit
    if (initialMessage) {
        await processInitialMessage();
        return;
    }
    
    // Otherwise start the server normally
    const server = http.createServer(app);

    // Create WebSocket server
    const wss = new WebSocket.Server({ server });

    // Message queue to hold messages to be sent
    const messageQueue = new Map(); 

    // Function to process the message queue
    async function processQueue(ws) {
        const sessionId = ws.sessionId;
        const queue = messageQueue.get(sessionId);
        if (!queue || queue.length === 0) return;

        const message = queue.shift();
        if (!message) return;

        try {
            await new Promise((resolve, reject) => {
                ws.send(safeStringify(message, 'processQueue'), (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            
            // Process next message if any
            if (queue.length > 0) {
                setTimeout(() => processQueue(ws), 10); 
            }
        } catch (error) {
            logger.error('websocket', 'Error sending message', { error, message });
        }
    }

    // Handle WebSocket connections
    wss.on('connection', async (ws) => {
        const sessionId = uuidv4();
        const isNewSession = !sessions.has(sessionId);
        
        // Initialize logger for this session
        await logger.initialize(sessionId);
        
        sessions.set(sessionId, []);
        wsConnections.set(sessionId, ws);
        ws.sessionId = sessionId;
        messageQueue.set(sessionId, []); 
        
        // Only reset memory for new sessions, not reconnections
        if (isNewSession) {
            await core.memory.resetMemory();
        }

        // Send initial connection message
        ws.send(safeStringify({
            type: 'connected',
            sessionId,
            isNewSession
        }, 'websocket.connection'));

        logger.debug('websocket', 'New WebSocket connection', { sessionId, isNewSession });

        ws.on("message", async (message) => {
            try {
                const data = JSON.parse(message);
                logger.debug("websocket", "Received message", { sessionId: ws.sessionId, data });

                // Get session history
                let sessionHistory = sessions.get(ws.sessionId) || [];

                // Process message through ego
                await ego.processMessage(data.message, sessionHistory);
            } catch (error) {
                logger.error("websocket", "Error processing message", {
                    sessionId: ws.sessionId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                    },
                });

                ws.send(
                    JSON.stringify({
                        type: "error",
                        error: {
                            message: error.message,
                            timestamp: new Date().toISOString(),
                        },
                    })
                );
            }
        });

        ws.on("close", () => {
            logger.debug("websocket", "Connection closed", { sessionId: ws.sessionId });
            wsConnections.delete(ws.sessionId);
            messageQueue.delete(ws.sessionId); 
            sessions.delete(ws.sessionId);
        });

        sharedEventEmitter.on("assistantResponse", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({ 
                    type: "response", 
                    data: { response: data }  
                });
                processQueue(ws);
            }

            let sessionHistory = sessions.get(ws.sessionId) || [];
            sessionHistory.push({
                role: "assistant",
                content: data,
            });
            sessions.set(ws.sessionId, sessionHistory);

            // Log response to file
            await logger.debug("response", "Assistant response", { response: data });
        });

        sharedEventEmitter.on("systemStatusMessage", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({ 
                    type: "working", 
                    data: { status: data }  
                });
                processQueue(ws);
            }

            // Log working status to file
            await logger.debug("working", "Assistant working", { status: data });
        });

        sharedEventEmitter.on("subsystemMessage", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({ 
                    type: "subsystem", 
                    data: { 
                        module: data.module,
                        content: data.content 
                    }  
                });
                processQueue(ws);
            }

            // Log subsystem message to file
            await logger.debug("subsystem", `${data.module} subsystem message`, { 
                module: data.module,
                content: data.content 
            });
        });

        sharedEventEmitter.on("systemError", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({ 
                    type: "systemError", 
                    data: { 
                        module: data.module,
                        content: data.content 
                    }  
                });
                processQueue(ws);
            }

            // Log system error to file
            await logger.error("systemError", `${data.module} system error`, { 
                module: data.module,
                content: data.content 
            });
        });

        sharedEventEmitter.on("debugResponse", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({
                    type: "debug",
                    data: data  
                });
                processQueue(ws);
            }

            let sessionHistory = sessions.get(ws.sessionId) || [];
            sessionHistory.push({
                role: "assistantDebug",
                content: data,
            });
            sessions.set(ws.sessionId, sessionHistory);
        });
    });

    // Session history endpoint
    app.get("/chat/:sessionId/history", (req, res) => {
        const { sessionId } = req.params;
        const history = sessions.get(sessionId) || [];
        res.json(history);
    });

    // Start the server only if this file is run directly
    if (require.main === module) {
        const port = process.env.PORT || 3000;
        server.listen(port, () => {
            logger.debug("server", `Server running on port ${port}`);
        });
    }
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };
